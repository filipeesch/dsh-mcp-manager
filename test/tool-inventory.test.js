/**
 * Tool inventory: `GET /mcp-manager/api/servers/:id/tools`.
 *
 * The endpoint is the only place the settings page can read the raw names of a
 * live connection. It resolves the same ids `/logs` resolves (global server,
 * loaded workspace server, projected workspace row) and keeps the polled list
 * endpoints count-only.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, it } from 'node:test';

const scratch = mkdtempSync(join(tmpdir(), 'dsh-mm-tools-'));
process.env.HOME = scratch;
process.env.USERPROFILE = scratch;
process.env.DSH_HOME = scratch;
const { apply } = await import('../lib/index.js');
after(() => rmSync(scratch, { recursive: true, force: true }));
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, ms = 2500) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await sleep(10); }
  assert.ok(await fn(), 'condition did not become true');
}

// Loopback MCP fixture whose tools/list answer can change between connections.
async function endpoint(initialTools = ['echo'], { initializeDelayMs = 0 } = {}) {
  let tools = [...initialTools];
  let opens = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const msg = JSON.parse(body || '{}');
      const reply = (result) => {
        if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      };
      if (msg.method === 'initialize') {
        opens++;
        const answer = () => reply({ protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } });
        if (initializeDelayMs) setTimeout(answer, initializeDelayMs);
        else answer();
        return;
      }
      if (msg.method === 'tools/list') {
        reply({ tools: tools.map(name => ({ name, description: name, inputSchema: { type: 'object' } })) });
        return;
      }
      reply({ content: [{ type: 'text', text: 'ok' }] });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/mcp`,
    opens: () => opens,
    setTools: (next) => { tools = [...next]; },
    stop: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}

// The broker is enabled by default now, so the stub registry carries its hooks.
function toolRegistry() {
  const registered = new Map();
  return {
    registered,
    register(def) { registered.set(def.name, def); return () => registered.delete(def.name); },
    guard: () => () => {},
    restrict: () => () => {},
    get: name => registered.get(name),
    schemas: () => [...registered.values()].map(({ name, description, parameters }) => ({ name, description, parameters })),
    execute: async () => ({ content: [] }),
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
  const effect = fn => { const dispose = fn(); if (typeof dispose === 'function') cleanup.push(dispose); return () => {}; };
  const webServer = { register: route => { handler = route.handler; return () => {}; } };
  const makeAgent = cwd => {
    const registry = toolRegistry();
    const agent = { id: `agent-${cwd}`, session: { header: { cwd } }, ctx: { tools: registry } };
    agentsByPath.set(cwd, agent);
    return registry;
  };
  const agents = {
    create(options) {
      const registry = makeAgent(options.cwd);
      const ready = Promise.resolve(options.setup({ effect: fn => { cleanup.push(fn()); } }, agentsByPath.get(options.cwd)));
      return { agent: agentsByPath.get(options.cwd), registry, ready, dispose() {} };
    },
    resume(options) { return this.create(options); },
  };
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: rootRegistry,
    get: name => name === 'workspaceRegistry' ? { list: () => [...workspaces.keys()].map(path => ({ path })) } : undefined,
    on: () => () => {},
    effect,
    inject: (names, callback) => { callback({ agents, webServer, effect }); return { dispose() {} }; },
  };
  writeFileSync(join(stateDir, 'mcp-manager.json'), JSON.stringify({ servers: [] }));
  apply(ctx);
  t.after(() => {
    for (const fn of cleanup.reverse()) { try { fn(); } catch {} }
  });

  const workspace = (path, config) => {
    const dir = join(scratch, `ws-${path}`);
    mkdirSync(join(dir, '.dsh/dshmm'), { recursive: true });
    const file = join(dir, '.dsh/dshmm/mcp.json');
    writeFileSync(file, JSON.stringify(config, null, 2));
    workspaces.set(dir, file);
    return {
      dir,
      attach: () => agents.create({ cwd: dir }),
    };
  };

  const request = async (method, suffix, body) => {
    const req = { method, url: `/mcp-manager/api${suffix}`, headers: { host: 'localhost' }, async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); } };
    let code, data;
    await handler(req, { writeHead(value) { code = value; }, end(value) { data = value ? JSON.parse(value) : undefined; } });
    return { code, ...data };
  };
  const server = {
    async create(name, url, authMode = 'none') {
      const created = await request('POST', '/servers', { name, type: 'http', authMode, url });
      assert.equal(created.code, 201, JSON.stringify(created));
      return created.server.id;
    },
    async add(name, url) {
      const id = await this.create(name, url);
      const connected = await request('POST', `/servers/${id}/connect`);
      assert.equal(connected.code, 200, JSON.stringify(connected));
      return id;
    },
  };
  const view = async path => (await request('GET', '/workspaces')).workspaces.find(ws => ws.path === path);
  return { request, workspace, server, view };
}

const local = url => ({ mcpServers: { local: { type: 'http', url, authMode: 'none' } } });

it('lists the raw names of a connected global server, sorted and without the prefix', async t => {
  const remote = await endpoint(['zebra', 'alpha', 'middle']); t.after(remote.stop);
  const h = mount(t);
  const id = await h.server.add('global', remote.url);

  const inventory = await h.request('GET', `/servers/${id}/tools`);
  assert.equal(inventory.code, 200, JSON.stringify(inventory));
  assert.deepEqual(inventory.tools, ['alpha', 'middle', 'zebra']);
  assert.ok(inventory.tools.every(name => !name.startsWith('mcp__')), 'raw names only');
  assert.equal(new Set(inventory.tools).size, inventory.tools.length, 'no duplicates');

  const lists = await h.request('GET', '/servers');
  const row = lists.servers.find(server => server.id === id);
  assert.equal(row.toolCount, 3);
  assert.equal('tools' in row, false, 'the polled view stays count-only');
});

it('answers a workspace server with the tools of that workspace connection', async t => {
  const remote = await endpoint(['workspace_only']); t.after(remote.stop);
  const h = mount(t);
  const a = h.workspace('own', local(remote.url));
  a.attach();
  await until(async () => (await h.view(a.dir))?.servers.some(server => server.status === 'connected'));
  const row = (await h.view(a.dir)).servers.find(server => server.name === 'local');

  const inventory = await h.request('GET', `/servers/${row.id}/tools`);
  assert.equal(inventory.code, 200, JSON.stringify(inventory));
  assert.deepEqual(inventory.tools, ['workspace_only']);
});

it('answers 409 for a projected row, a disabled server, needs-auth, error and while connecting', async t => {
  const slow = await endpoint(['echo'], { initializeDelayMs: 300 }); t.after(slow.stop);
  const dead = await endpoint(['echo']); t.after(dead.stop);
  const h = mount(t);

  // Declared on disk but never loaded: no live connection, no inventory.
  const projected = h.workspace('projected', local('http://127.0.0.1:9/mcp'));
  const projectedRow = (await h.view(projected.dir)).servers.find(server => server.name === 'local');
  assert.equal((await h.request('GET', `/servers/${projectedRow.id}/tools`)).code, 409);

  // Disabled global server: the live connection is dropped on disable.
  const disabled = await h.server.add('disabled', dead.url);
  await h.request('POST', `/servers/${disabled}/enabled`, { enabled: false });
  assert.equal((await h.request('GET', `/servers/${disabled}/tools`)).code, 409);

  // needs-auth starts before any handshake.
  const auth = await h.server.create('auth', 'https://example.test/mcp', 'oauth');
  assert.equal((await h.request('GET', `/servers/${auth}/tools`)).code, 409);

  // A refused handshake ends in error.
  const failing = await h.server.create('failing', 'http://127.0.0.1:1/mcp');
  await h.request('POST', `/servers/${failing}/connect`);
  const failed = await h.request('GET', '/servers');
  assert.equal(failed.servers.find(server => server.id === failing).status, 'error');
  assert.equal((await h.request('GET', `/servers/${failing}/tools`)).code, 409);

  // While the handshake is in flight the connection is not connected yet.
  const pendingId = await h.server.create('pending', slow.url);
  const pending = h.request('POST', `/servers/${pendingId}/connect`);
  await until(() => slow.opens() > 0);
  assert.equal((await h.request('GET', `/servers/${pendingId}/tools`)).code, 409);
  await pending;

  // Unknown id.
  assert.equal((await h.request('GET', '/servers/does-not-exist/tools')).code, 404);
});

it('returns an empty list for a connected server with no tools', async t => {
  const remote = await endpoint([]); t.after(remote.stop);
  const h = mount(t);
  const id = await h.server.add('empty', remote.url);

  const inventory = await h.request('GET', `/servers/${id}/tools`);
  assert.equal(inventory.code, 200, JSON.stringify(inventory));
  assert.deepEqual(inventory.tools, []);
});

it('keeps the workspace list count-only regardless of the tool count', async t => {
  const remote = await endpoint(['one']); t.after(remote.stop);
  const h = mount(t);
  const a = h.workspace('countonly', local(remote.url));
  a.attach();
  await until(async () => (await h.view(a.dir))?.servers.some(server => server.status === 'connected'));
  const before = await h.view(a.dir);
  const beforeRow = before.servers.find(server => server.name === 'local');
  assert.equal(beforeRow.toolCount, 1);
  assert.equal('tools' in beforeRow, false, 'the workspace view stays count-only');
  const beforeSize = JSON.stringify(before).length;

  remote.setTools(Array.from({ length: 40 }, (_, index) => `tool_${String(index).padStart(2, '0')}`));
  const reconnected = await h.request('POST', `/servers/${beforeRow.id}/connect`);
  assert.equal(reconnected.code, 200, JSON.stringify(reconnected));
  await until(async () => (await h.request('GET', `/servers/${beforeRow.id}/tools`)).tools?.length === 40);

  const after = await h.view(a.dir);
  const afterRow = after.servers.find(server => server.name === 'local');
  assert.equal(afterRow.toolCount, 40);
  assert.equal('tools' in afterRow, false);
  assert.ok(JSON.stringify(after).length - beforeSize <= 4,
    `the workspace view must not grow with the tool count (${beforeSize} -> ${JSON.stringify(after).length})`);
});

it('answers 409 for a conflicting workspace row and a workspace-local disabled row', async t => {
  const remote = await endpoint(['echo']); t.after(remote.stop);
  const h = mount(t);
  await h.server.add('dup', remote.url);

  const conflictingWs = h.workspace('conflict', { mcpServers: { dup: { type: 'http', url: remote.url, authMode: 'none' } } });
  conflictingWs.attach();
  await until(async () => (await h.view(conflictingWs.dir))?.servers.some(server => server.status === 'conflict'));
  const conflicting = (await h.view(conflictingWs.dir)).servers.find(server => server.name === 'dup');
  assert.equal(conflicting.status, 'conflict');
  assert.equal((await h.request('GET', `/servers/${conflicting.id}/tools`)).code, 409);

  const disabledWs = h.workspace('disabled-local', {
    mcpServers: { local: { type: 'http', url: remote.url, authMode: 'none' } },
    disabled: ['local'],
  });
  disabledWs.attach();
  await until(async () => (await h.view(disabledWs.dir))?.servers.some(server => server.name === 'local'));
  const disabled = (await h.view(disabledWs.dir)).servers.find(server => server.name === 'local');
  assert.equal(disabled.status, 'disabled');
  assert.equal((await h.request('GET', `/servers/${disabled.id}/tools`)).code, 409);
});

it('follows a reconnect and keeps the polled views independent of the tool count', async t => {
  const remote = await endpoint(['one']); t.after(remote.stop);
  const h = mount(t);
  const id = await h.server.add('growing', remote.url);
  const before = JSON.stringify((await h.request('GET', '/servers')).servers.find(server => server.id === id)).length;

  remote.setTools(Array.from({ length: 40 }, (_, index) => `tool_${String(index).padStart(2, '0')}`));
  const reconnected = await h.request('POST', `/servers/${id}/connect`);
  assert.equal(reconnected.code, 200, JSON.stringify(reconnected));
  await until(async () => (await h.request('GET', `/servers/${id}/tools`)).tools?.length === 40);

  const inventory = await h.request('GET', `/servers/${id}/tools`);
  assert.equal(inventory.tools[0], 'tool_00');
  assert.equal(inventory.tools.at(-1), 'tool_39');
  const after = JSON.stringify((await h.request('GET', '/servers')).servers.find(server => server.id === id)).length;
  assert.ok(after - before <= 4, `the list payload must not grow with the tool count (${before} -> ${after})`);
});
