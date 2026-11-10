/**
 * A server that needs authentication keeps its tools visible through the catalog
 * it retained, a call to them fails at once naming the authorization tool, and
 * the inventory endpoint reports the retained names as stale.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, it } from 'node:test';

const scratch = mkdtempSync(join(tmpdir(), 'dsh-mm-unauth-'));
process.env.HOME = scratch;
process.env.USERPROFILE = scratch;
process.env.DSH_HOME = scratch;
const { apply } = await import('../lib/index.js');
after(() => rmSync(scratch, { recursive: true, force: true }));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await sleep(10); }
  assert.ok(await fn(), 'condition did not become true');
}

// Loopback MCP endpoint whose listing and authentication behavior can be switched
// between calls: 'ok' answers initialize and tools/list, 'reject' answers 401 to
// everything, which is what a server with an expired session looks like.
async function endpoint(initialTools = ['echo']) {
  let tools = [...initialTools];
  let mode = 'ok';
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      if (mode === 'reject') {
        res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="mcp"' });
        res.end('{}');
        return;
      }
      const msg = JSON.parse(body || '{}');
      const reply = (result) => {
        if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      };
      if (msg.method === 'initialize') {
        reply({ protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } });
        return;
      }
      if (msg.method === 'tools/list') {
        reply({ tools: tools.map((name) => ({ name, description: `does ${name}`, inputSchema: { type: 'object' } })) });
        return;
      }
      reply({ content: [{ type: 'text', text: 'ok' }] });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/mcp`,
    setTools: (next) => { tools = [...next]; },
    setMode: (next) => { mode = next; },
    stop: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); },
  };
}

function toolRegistry() {
  const registered = new Map();
  return {
    registered,
    register(definition) { registered.set(definition.name, definition); return () => registered.delete(definition.name); },
    guard: () => () => {},
    restrict: () => () => {},
    get: (name) => registered.get(name),
    schemas: () => [...registered.values()].map(({ name, description, parameters }) => ({ name, description, parameters })),
    // The broker dispatches a nested single-call batch; run the registered
    // definition so a cached tool's failure is the one the model would see.
    async execute(request) {
      const call = Array.isArray(request?.calls) ? request.calls[0] : undefined;
      const definition = registered.get(call?.name ?? request?.name);
      if (definition === undefined) throw new Error(`no such tool: ${call?.name ?? request?.name}`);
      const args = call?.arguments === undefined ? (request.arguments ?? {}) : JSON.parse(call.arguments);
      return { results: [{ result: await definition.execute(args, { agent: request.agent }) }] };
    },
  };
}

function mount(t) {
  const stateDir = join(scratch, '.dsh');
  mkdirSync(stateDir, { recursive: true });
  const rootRegistry = toolRegistry();
  const agentsByPath = new Map();
  const cleanup = [];
  const workspaces = new Map();
  let handler;
  const effect = (fn) => { const dispose = fn(); if (typeof dispose === 'function') cleanup.push(dispose); return () => {}; };
  const webServer = { register: (route) => { handler = route.handler; return () => {}; } };
  const agents = {
    create(options) {
      const registry = toolRegistry();
      const agent = { id: `agent-${options.cwd}`, session: { header: { cwd: options.cwd } }, ctx: { tools: registry } };
      agentsByPath.set(options.cwd, agent);
      const ready = Promise.resolve(options.setup({ effect: (fn) => { cleanup.push(fn()); } }, agent));
      return { agent, registry, ready, dispose() {} };
    },
    resume(options) { return this.create(options); },
  };
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: rootRegistry,
    get: (name) => (name === 'workspaceRegistry'
      ? { list: () => [...workspaces.keys()].map((path) => ({ path })) }
      : undefined),
    on: () => () => {},
    effect,
    inject: (names, callback) => { callback({ agents, webServer, effect }); return { dispose() {} }; },
  };
  writeFileSync(join(stateDir, 'mcp-manager.json'), JSON.stringify({ servers: [] }));
  apply(ctx);
  t.after(() => { for (const fn of cleanup.reverse()) { try { fn(); } catch {} } });

  const request = async (method, suffix, body) => {
    const req = {
      method,
      url: `/mcp-manager/api${suffix}`,
      headers: { host: 'localhost' },
      async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); },
    };
    let code;
    let data;
    await handler(req, { writeHead(value) { code = value; }, end(value) { data = value ? JSON.parse(value) : undefined; } });
    return { code, ...data };
  };
  const workspace = (name, config) => {
    const dir = join(scratch, `ws-${name}`);
    mkdirSync(join(dir, '.dsh/dshmm'), { recursive: true });
    writeFileSync(join(dir, '.dsh/dshmm/mcp.json'), JSON.stringify(config, null, 2));
    workspaces.set(dir, true);
    return { dir, attach: () => agents.create({ cwd: dir }) };
  };
  const mcpToolNames = () => [...rootRegistry.registered.keys()].filter((name) => name.startsWith('mcp__')).sort();
  const statusOf = async (id) => (await request('GET', '/servers')).servers.find((server) => server.id === id)?.status;
  return {
    request,
    workspace,
    mcpToolNames,
    statusOf,
    tool: (name) => rootRegistry.registered.get(name),
    agentTools: (cwd) => (agentsByPath.get(cwd)?.ctx.tools.registered),
    async add(name, url, authMode = 'oauth') {
      const created = await request('POST', '/servers', { name, type: 'http', authMode, url });
      assert.equal(created.code, 201, JSON.stringify(created));
      const connected = await request('POST', `/servers/${created.server.id}/connect`);
      assert.equal(connected.code, 200, JSON.stringify(connected));
      return created.server.id;
    },
  };
}

it('keeps a server visible through its catalog and fails the call at once', async (t) => {
  const remote = await endpoint(['zebra', 'alpha']);
  t.after(remote.stop);
  const h = mount(t);
  const id = await h.add('cached', remote.url);
  await until(() => h.mcpToolNames().length === 2);
  const liveDescription = h.tool('mcp__cached__alpha').description;

  remote.setMode('reject');
  await h.request('POST', `/servers/${id}/connect`);
  await until(async () => (await h.statusOf(id)) === 'needs-auth');

  assert.deepEqual(h.mcpToolNames(), ['mcp__cached__alpha', 'mcp__cached__zebra']);
  assert.equal(h.tool('mcp__cached__alpha').description, liveDescription);

  const failure = await h.tool('mcp__cached__alpha').execute({}, {}).then(() => null, (error) => error);
  assert.ok(failure, 'the call must fail');
  assert.match(failure.message, /mcp_authenticate_server\("cached"\)/);
  assert.match(failure.message, /was not executed/);

  const attention = await h.request('GET', '/attention');
  assert.deepEqual(attention.items, []);

  const inventory = await h.request('GET', `/servers/${id}/tools`);
  assert.equal(inventory.code, 200);
  assert.deepEqual(inventory.tools, ['alpha', 'zebra']);
  assert.equal(inventory.stale, true);
});

it('keeps cached definitions reachable through the on-demand broker', async (t) => {
  const remote = await endpoint(['zebra']);
  t.after(remote.stop);
  const h = mount(t);
  const id = await h.add('brokered', remote.url);
  await until(() => h.mcpToolNames().length === 1);

  remote.setMode('reject');
  await h.request('POST', `/servers/${id}/connect`);
  await until(async () => (await h.statusOf(id)) === 'needs-auth');

  // The broker stays the only way in for a native agent, so a cached definition
  // has to keep the same deferral marker a live one carries.
  assert.equal(h.tool('mcp__brokered__zebra').deferLoading, true);

  const search = await h.tool('mcp_search_tools').execute({ query: 'zebra' }, {});
  assert.deepEqual(search.matches.map((match) => match.name), ['mcp__brokered__zebra']);

  const described = await h.tool('mcp_describe_tool').execute({ name: 'mcp__brokered__zebra' }, {});
  assert.equal(described.name, 'mcp__brokered__zebra');

  // Dispatching the cached definition fails with the instruction, never with a
  // transport error and never by waiting.
  const failure = await h.tool('mcp_execute_tool').execute({ name: 'mcp__brokered__zebra', arguments: {} }, {})
    .then(() => null, (error) => error);
  assert.ok(failure, 'the broker dispatch must fail');
  assert.match(failure.message, /mcp_authenticate_server\("brokered"\)/);
});

it('exposes nothing for a server that never listed its tools', async (t) => {
  const remote = await endpoint();
  t.after(remote.stop);
  const h = mount(t);
  const created = await h.request('POST', '/servers', { name: 'fresh', type: 'http', authMode: 'oauth', url: remote.url });
  assert.equal(created.code, 201);
  assert.equal(created.server.status, 'needs-auth');
  assert.deepEqual(h.mcpToolNames(), []);
  const inventory = await h.request('GET', `/servers/${created.server.id}/tools`);
  assert.equal(inventory.code, 409);
  assert.equal(inventory.stale, undefined);
});

it('discards the catalog when an import deletes the server', async (t) => {
  const remote = await endpoint(['alpha']);
  t.after(remote.stop);
  const h = mount(t);
  const id = await h.add('imported', remote.url);
  await until(() => h.mcpToolNames().length === 1);

  const catalogPath = join(scratch, '.dsh', 'mcp-manager-tools.json');
  await until(() => {
    try { return Object.hasOwn(JSON.parse(readFileSync(catalogPath, 'utf8')).servers, `id:${id}`); } catch { return false; }
  });
  const applied = await h.request('POST', '/import', { scope: 'global', mode: 'edit', document: { mcpServers: {} } });
  assert.equal(applied.code, 200, JSON.stringify(applied));
  await until(() => !Object.hasOwn(JSON.parse(readFileSync(catalogPath, 'utf8')).servers, `id:${id}`));
  assert.deepEqual(h.mcpToolNames(), []);
});

it('exposes nothing while a server is disabled', async (t) => {
  const remote = await endpoint(['alpha']);
  t.after(remote.stop);
  const h = mount(t);
  const id = await h.add('off', remote.url);
  await until(() => h.mcpToolNames().length === 1);

  const disabled = await h.request('POST', `/servers/${id}/enabled`, { enabled: false });
  assert.equal(disabled.code, 200);
  assert.deepEqual(h.mcpToolNames(), []);
  const inventory = await h.request('GET', `/servers/${id}/tools`);
  assert.equal(inventory.code, 409);
});

it('replaces the catalog with the live listing after reconnecting', async (t) => {
  const remote = await endpoint(['alpha']);
  t.after(remote.stop);
  const h = mount(t);
  const id = await h.add('returns', remote.url);
  await until(() => h.mcpToolNames().length === 1);

  remote.setMode('reject');
  await h.request('POST', `/servers/${id}/connect`);
  await until(async () => (await h.statusOf(id)) === 'needs-auth');
  assert.deepEqual(h.mcpToolNames(), ['mcp__returns__alpha']);

  remote.setTools(['alpha', 'beta']);
  remote.setMode('ok');
  await h.request('POST', `/servers/${id}/connect`);
  await until(async () => (await h.statusOf(id)) === 'connected');
  await until(() => h.mcpToolNames().length === 2);
  assert.deepEqual(h.mcpToolNames(), ['mcp__returns__alpha', 'mcp__returns__beta']);
  const inventory = await h.request('GET', `/servers/${id}/tools`);
  assert.equal(inventory.stale, undefined);
});

it('exposes a workspace server catalog inside its own agent scope', async (t) => {
  const remote = await endpoint();
  t.after(remote.stop);
  const h = mount(t);
  const ws = h.workspace('scope', { mcpServers: { local: { type: 'http', url: remote.url, authMode: 'oauth' } } });
  // The catalog of a workspace server is keyed by the workspace path and the
  // server name, so a regenerated workspace id keeps its entries.
  const key = `ws:${realpathSync(ws.dir)}\u0000local`;
  writeFileSync(join(scratch, '.dsh', 'mcp-manager-tools.json'), JSON.stringify({
    version: 1,
    servers: { [key]: { name: 'local', listedAt: 1, tools: [{ name: 'local-tool', description: 'does local-tool', inputSchema: { type: 'object' } }] } },
  }));

  const agent = ws.attach();
  await agent.ready;
  await until(() => h.agentTools(ws.dir)?.has('mcp__local__local-tool') === true);

  const failure = await h.agentTools(ws.dir).get('mcp__local__local-tool').execute({}, {}).then(() => null, (error) => error);
  assert.ok(failure, 'the call must fail');
  assert.match(failure.message, /mcp_authenticate_server\("local"\)/);
});
