/**
 * `POST /mcp-manager/api/import`: preview, atomic application, both scopes,
 * both modes, conflicts, and the state a batch must not disturb.
 *
 * Servers are created without usable credentials on purpose, so nothing opens a
 * socket: an OAuth server without tokens and a static server whose env var is
 * unset both land in `needs-auth` without connecting.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, it } from 'node:test';

const scratch = mkdtempSync(join(tmpdir(), 'dsh-mm-import-'));
process.env.HOME = scratch;
process.env.USERPROFILE = scratch;
process.env.DSH_HOME = scratch;
const { apply } = await import('../lib/index.js');
after(() => rmSync(scratch, { recursive: true, force: true }));

const STATE = join(scratch, '.dsh', 'mcp-manager.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, ms = 2500) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await sleep(10); }
  assert.ok(await fn(), 'condition did not become true');
}

// Loopback MCP fixture: one `echo` tool, no auth, counts initializations.
async function endpoint() {
  let opens = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      const msg = JSON.parse(body || '{}');
      const result = msg.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'test', version: '1' } }
        : msg.method === 'tools/list' ? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
        : { content: [{ type: 'text', text: 'ok' }] };
      if (msg.method === 'initialize') opens++;
      if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const stop = async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); };
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, opens: () => opens, stop };
}

function toolRegistry() {
  const registered = new Map();
  return {
    registered,
    register(def) { registered.set(def.name, def); return () => registered.delete(def.name); },
    guard: () => () => {},
    restrict: () => () => {},
    schemas: () => [],
    execute: async () => ({ content: [] }),
  };
}

function mount(t, initialState = { servers: [] }) {
  mkdirSync(join(scratch, '.dsh'), { recursive: true });
  writeFileSync(STATE, JSON.stringify(initialState));
  const workspaces = new Map();
  const cleanup = [];
  let handler;
  const effect = (fn) => { const dispose = fn(); if (typeof dispose === 'function') cleanup.push(dispose); return () => {}; };
  const webServer = { register: (route) => { handler = route.handler; return () => {}; } };
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: toolRegistry(),
    get: (name) => (name === 'workspaceRegistry' ? { list: () => [...workspaces.keys()].map((path) => ({ path })) } : undefined),
    on: () => () => {},
    effect,
    inject: (names, callback) => {
      callback({ webServer, effect, agents: undefined });
      return { dispose() {} };
    },
  };
  apply(ctx);
  t.after(() => { for (const fn of cleanup.reverse()) { try { fn(); } catch {} } });

  const workspace = (label, config) => {
    const dir = join(scratch, `ws-${label}`);
    mkdirSync(join(dir, '.dsh/dshmm'), { recursive: true });
    const file = join(dir, '.dsh/dshmm/mcp.json');
    const write = (value) => writeFileSync(file, JSON.stringify(value, null, 2));
    if (config) write(config);
    workspaces.set(dir, file);
    return {
      dir,
      write,
      read: () => JSON.parse(readFileSync(file, 'utf8')),
    };
  };

  const request = async (method, suffix, body) => {
    const req = {
      method,
      url: `/mcp-manager/api${suffix}`,
      headers: { host: 'localhost' },
      async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); },
    };
    let code;
    let data;
    await handler(req, {
      writeHead(value) { code = value; },
      end(value) { data = value ? JSON.parse(value) : undefined; },
    });
    return { code, ...data };
  };

  return {
    request,
    workspace,
    state: () => JSON.parse(readFileSync(STATE, 'utf8')),
    servers: async () => (await request('GET', '/servers')).servers,
    workspaceView: async (path) => (await request('GET', '/workspaces')).workspaces.find((ws) => ws.path === path),
  };
}

const httpServer = (overrides = {}) => ({ type: 'http', url: 'https://mcp.example.com/mcp', authMode: 'oauth', ...overrides });

it('previews without writing and applies the same batch', async (t) => {
  const h = mount(t);
  const document = {
    mcpServers: {
      github: httpServer({ url: 'https://api.github.com/mcp' }),
      unity: httpServer({ url: 'http://localhost:8090/', authMode: 'static', tokenEnv: 'DSH_TEST_UNSET_TOKEN' }),
    },
  };
  const preview = await h.request('POST', '/import', { scope: 'global', mode: 'import', dryRun: true, mcpServers: document.mcpServers });
  assert.equal(preview.code, 200);
  assert.equal(preview.plan.summary.new, 2);
  assert.equal(preview.applied, undefined);
  assert.deepEqual(h.state().servers, [], 'a preview writes nothing');

  const applied = await h.request('POST', '/import', { scope: 'global', mode: 'import', mcpServers: document.mcpServers });
  assert.equal(applied.code, 200);
  assert.equal(applied.applied, true);
  assert.equal(applied.plan.appliedCount, 2);
  const servers = await h.servers();
  assert.deepEqual(servers.map((server) => server.name).sort(), ['github', 'unity']);
  assert.equal(servers.find((server) => server.name === 'github').status, 'needs-auth');
});

it('aborts the whole batch when one entry is invalid', async (t) => {
  const h = mount(t);
  const response = await h.request('POST', '/import', {
    scope: 'global',
    mode: 'import',
    mcpServers: { good: httpServer(), bad: { type: 'http', url: 'not-a-url' } },
  });
  assert.equal(response.code, 400);
  assert.equal(response.plan.blocked, 'invalid');
  const bad = response.plan.entries.find((entry) => entry.name === 'bad');
  assert.equal(bad.error.field, 'url');
  assert.deepEqual(h.state().servers, [], 'nothing is written');
});

it('writes a workspace entry without touching the rest of the file', async (t) => {
  const h = mount(t);
  const ws = h.workspace('a', {
    mcpServers: { keep: { type: 'http', url: 'https://keep.test/mcp', authMode: 'none' } },
    disabled: ['keep'],
    exclude: ['legacy'],
    customKey: { preserved: true },
  });
  const response = await h.request('POST', '/import', {
    scope: 'workspace',
    path: ws.dir,
    mode: 'import',
    mcpServers: { added: httpServer({ url: 'https://added.test/mcp', authMode: 'none' }) },
  });
  assert.equal(response.code, 200, JSON.stringify(response));
  const raw = ws.read();
  assert.deepEqual(Object.keys(raw.mcpServers).sort(), ['added', 'keep']);
  assert.deepEqual(raw.disabled, ['keep']);
  assert.deepEqual(raw.exclude, ['legacy']);
  assert.deepEqual(raw.customKey, { preserved: true });
  assert.equal(raw.mcpServers.added.authMode, 'none');
  assert.equal(raw.mcpServers.added.oauth, undefined);
});

it('rejects a workspace that is not registered', async (t) => {
  const h = mount(t);
  const response = await h.request('POST', '/import', {
    scope: 'workspace',
    path: '/tmp/not-a-workspace',
    mode: 'import',
    mcpServers: { x: httpServer() },
  });
  assert.equal(response.code, 403);
});

it('classifies a cross-scope name as a conflict and honours keep and replace', async (t) => {
  const h = mount(t, { servers: [{ id: 'g1', name: 'shared', type: 'http', url: 'https://shared.test/mcp', authMode: 'oauth' }] });
  const ws = h.workspace('b', { mcpServers: {} });
  const payload = {
    scope: 'workspace',
    path: ws.dir,
    mode: 'import',
    mcpServers: { shared: httpServer({ url: 'http://127.0.0.1:27123/' }) },
  };
  const preview = await h.request('POST', '/import', { ...payload, dryRun: true });
  assert.equal(preview.plan.entries[0].action, 'conflict');
  assert.equal(preview.plan.entries[0].conflict.scope, 'global');
  assert.equal(preview.plan.blocked, 'conflict');

  const kept = await h.request('POST', '/import', { ...payload, resolutions: { shared: 'keep' } });
  assert.equal(kept.code, 200);
  assert.deepEqual(ws.read().mcpServers, {}, 'keep writes nothing');
  assert.equal(h.state().servers.length, 1, 'the profile server survives');

  const replaced = await h.request('POST', '/import', { ...payload, resolutions: { shared: 'replace' } });
  assert.equal(replaced.code, 200);
  assert.equal(h.state().servers.length, 0, 'the profile row is gone');
  assert.equal(ws.read().mcpServers.shared.url, 'http://127.0.0.1:27123/');
});

it('keeps the stored OAuth session when an update leaves the identity alone', async (t) => {
  const oauth = { authorizationServer: 'https://auth.example.com', tokens: { access_token: 'kept', refresh_token: 'kept', expires_at: Date.now() + 3_600_000 } };
  const row = { id: 'g1', name: 'github', type: 'http', authMode: 'oauth', url: 'https://mcp.example.com/mcp', oauth };
  const h = mount(t, { servers: [row] });
  const response = await h.request('POST', '/import', {
    scope: 'global',
    mode: 'import',
    mcpServers: { github: httpServer({ url: 'https://mcp.example.com/v2' }) },
  });
  assert.equal(response.code, 200, JSON.stringify(response));
  assert.equal(response.plan.entries[0].keepsSession, true);
  const saved = h.state().servers[0];
  assert.equal(saved.url, 'https://mcp.example.com/v2');
  assert.deepEqual(saved.oauth.tokens, oauth.tokens);
});

it('drops the stored OAuth session when the client identity changes', async (t) => {
  const oauth = { authorizationServer: 'https://auth.example.com', tokens: { access_token: 'old' } };
  const row = { id: 'g1', name: 'github', type: 'http', authMode: 'oauth', url: 'https://mcp.example.com/mcp', clientId: 'abc', oauth };
  const h = mount(t, { servers: [row] });
  const response = await h.request('POST', '/import', {
    scope: 'global',
    mode: 'import',
    mcpServers: { github: httpServer({ url: 'https://mcp.example.com/mcp', clientId: 'def' }) },
  });
  assert.equal(response.code, 200, JSON.stringify(response));
  assert.equal(response.plan.entries[0].keepsSession, false);
  assert.equal(h.state().servers[0].oauth, undefined);
});

it('deletes an absent entry only in edit mode', async (t) => {
  const h = mount(t, {
    servers: [
      { id: 'g1', name: 'keep', type: 'http', authMode: 'oauth', url: 'https://keep.test/mcp' },
      { id: 'g2', name: 'drop', type: 'http', authMode: 'oauth', url: 'https://drop.test/mcp' },
    ],
  });
  const importing = await h.request('POST', '/import', {
    scope: 'global',
    mode: 'import',
    mcpServers: { keep: httpServer({ url: 'https://keep.test/mcp' }) },
  });
  assert.equal(importing.code, 200);
  assert.deepEqual(h.state().servers.map((server) => server.name).sort(), ['drop', 'keep']);

  const editing = await h.request('POST', '/import', {
    scope: 'global',
    mode: 'edit',
    mcpServers: { keep: httpServer({ url: 'https://keep.test/mcp' }) },
  });
  assert.equal(editing.code, 200, JSON.stringify(editing));
  assert.equal(editing.plan.summary.delete, 1);
  assert.deepEqual(h.state().servers.map((server) => server.name), ['keep']);
});

it('leaves a disabled server disabled and disconnected', async (t) => {
  const h = mount(t, { servers: [{ id: 'g1', name: 'github', type: 'http', authMode: 'oauth', url: 'https://mcp.example.com/mcp', enabled: false }] });
  const response = await h.request('POST', '/import', {
    scope: 'global',
    mode: 'import',
    mcpServers: { github: httpServer({ url: 'https://mcp.example.com/v2' }) },
  });
  assert.equal(response.code, 200, JSON.stringify(response));
  const [server] = await h.servers();
  assert.equal(server.enabled, false);
  assert.equal(server.status, 'disabled');
  assert.equal(h.state().servers[0].enabled, false, 'the edit never touches the switch');
});

it('prunes the workspace off lists when an edit deletes a local server', async (t) => {
  const h = mount(t);
  const ws = h.workspace('c', {
    mcpServers: { local: { type: 'http', url: 'https://local.test/mcp', authMode: 'none' } },
    disabled: ['local', 'other'],
    exclude: ['local'],
  });
  const response = await h.request('POST', '/import', {
    scope: 'workspace',
    path: ws.dir,
    mode: 'edit',
    mcpServers: {},
  });
  assert.equal(response.code, 200, JSON.stringify(response));
  const raw = ws.read();
  assert.deepEqual(raw.mcpServers, {});
  assert.deepEqual(raw.disabled, ['other'], 'the deleted name leaves the off list');
  assert.equal(raw.exclude, undefined, 'an emptied list is dropped');
});

it('rejects a document that names a server other than the locked one', async (t) => {
  const h = mount(t);
  const wrongDocument = await h.request('POST', '/import', {
    scope: 'global',
    mode: 'edit',
    lockedName: 'github',
    mcpServers: { unity: httpServer() },
  });
  assert.equal(wrongDocument.code, 400);
  assert.match(wrongDocument.error, /must describe the server "github"/);
});

it('reports a per-entry field for a credential-shaped value', async (t) => {
  const h = mount(t);
  const response = await h.request('POST', '/import', {
    scope: 'global',
    mode: 'import',
    mcpServers: { github: httpServer({ clientSecretEnv: 'sk-live-not-an-env-name' }) },
  });
  assert.equal(response.code, 400);
  assert.equal(response.plan.entries[0].error.field, 'clientSecretEnv');
});

it('rejects a batch over the size limit before validating it', async (t) => {
  const h = mount(t);
  const response = await h.request('POST', '/import', {
    scope: 'global',
    mode: 'import',
    document: 'x'.repeat(1024 * 1024 + 10),
  });
  assert.equal(response.code, 400);
  assert.match(response.error, /KiB|invalid JSON/);
});

it('connects a created server, reconnects a changed one and leaves an unchanged one alone', async (t) => {
  const remote = await endpoint();
  t.after(remote.stop);
  const h = mount(t);
  const document = { live: { type: 'http', url: remote.url, authMode: 'none' } };
  const created = await h.request('POST', '/import', { scope: 'global', mode: 'import', mcpServers: document });
  assert.equal(created.code, 200, JSON.stringify(created));
  await until(() => remote.opens() === 1);

  // An identical document classifies as unchanged and must not churn the link.
  const again = await h.request('POST', '/import', { scope: 'global', mode: 'import', mcpServers: document });
  assert.equal(again.code, 200);
  assert.equal(again.plan.entries[0].action, 'unchanged');
  await sleep(150);
  assert.equal(remote.opens(), 1, 'an unchanged entry does not reconnect');

  // A changed URL reconnects with the new configuration.
  const changed = await h.request('POST', '/import', {
    scope: 'global',
    mode: 'import',
    mcpServers: { live: { type: 'http', url: `${remote.url}?v=2`, authMode: 'none' } },
  });
  assert.equal(changed.code, 200, JSON.stringify(changed));
  await until(() => remote.opens() === 2);
});

it('inherits the stored client identity and environment-variable name on an update', async (t) => {
  const oauth = { authorizationServer: 'https://auth.example.com', tokens: { access_token: 'kept', refresh_token: 'kept' } };
  const row = {
    id: 'g1',
    name: 'github',
    type: 'http',
    authMode: 'oauth',
    url: 'https://mcp.example.com/mcp',
    clientId: 'abc',
    clientSecretEnv: 'GITHUB_SECRET',
    clientName: 'my-client',
    scope: 'repo read:org',
    redirectUrl: 'http://127.0.0.1:7777/callback',
    oauth,
  };
  const staticRow = { id: 'g2', name: 'unity', type: 'http', authMode: 'static', url: 'http://localhost:8090/', tokenEnv: 'UNITY_TOKEN' };
  const h = mount(t, { servers: [row, staticRow] });
  const response = await h.request('POST', '/import', {
    scope: 'global',
    mode: 'import',
    mcpServers: {
      github: { type: 'http', url: 'https://mcp.example.com/v2', authMode: 'oauth' },
      unity: { type: 'http', url: 'http://localhost:8090/', authMode: 'static' },
    },
  });
  assert.equal(response.code, 200, JSON.stringify(response));
  const [github, unity] = h.state().servers;
  assert.equal(github.clientId, 'abc');
  assert.equal(github.clientSecretEnv, 'GITHUB_SECRET');
  assert.equal(github.clientName, 'my-client');
  assert.equal(github.scope, 'repo read:org');
  assert.equal(github.redirectUrl, 'http://127.0.0.1:7777/callback');
  assert.deepEqual(github.oauth.tokens, oauth.tokens, 'the session survives an update that keeps the identity');
  assert.equal(unity.tokenEnv, 'UNITY_TOKEN', 'an omitted tokenEnv inherits the stored name');
});

it('migrates a workspace session into the profile scope on replace', async (t) => {
  const dir = join(scratch, 'ws-migrate');
  mkdirSync(join(dir, '.dsh/dshmm'), { recursive: true });
  const canonical = realpathSync(dir);
  const oauth = { authorizationServer: 'https://auth.example.com', tokens: { access_token: 'x', refresh_token: 'y' } };
  const h = mount(t, { servers: [], workspaceTokens: { [`${canonical}\nshared`]: { oauth } } });
  const ws = h.workspace('migrate', {
    mcpServers: { shared: { type: 'http', url: 'https://shared.test/mcp', authMode: 'oauth', clientId: 'abc' } },
  });
  const reloaded = h;
  const response = await reloaded.request('POST', '/import', {
    scope: 'global',
    mode: 'import',
    mcpServers: { shared: { type: 'http', url: 'https://shared.test/mcp', authMode: 'oauth', clientId: 'abc' } },
    resolutions: { shared: 'replace' },
  });
  assert.equal(response.code, 200, JSON.stringify(response));
  assert.equal(response.plan.entries[0].keepsSession, true, 'the preview says the session will move');
  const [created] = reloaded.state().servers;
  assert.equal(created.name, 'shared');
  assert.deepEqual(created.oauth.tokens, oauth.tokens, 'the session followed the server into the profile scope');
  assert.deepEqual(ws.read().mcpServers, {}, 'the workspace declaration is gone');
  assert.deepEqual(reloaded.state().workspaceTokens, {}, 'and so is its slot');
});

it('drops the stored workspace session when an update changes the client id', async (t) => {
  const dir = join(scratch, 'ws-rotate');
  mkdirSync(join(dir, '.dsh/dshmm'), { recursive: true });
  const canonical = realpathSync(dir);
  const oauth = { authorizationServer: 'https://auth.example.com', tokens: { access_token: 'old' } };
  const h = mount(t, { servers: [], workspaceTokens: { [`${canonical}\ngithub`]: { oauth } } });
  const ws = h.workspace('rotate', {
    mcpServers: { github: { type: 'http', url: 'https://mcp.example.com/mcp', authMode: 'oauth', clientId: 'abc' } },
  });
  const reloaded = h;
  const response = await reloaded.request('POST', '/import', {
    scope: 'workspace',
    path: ws.dir,
    mode: 'import',
    mcpServers: { github: { type: 'http', url: 'https://mcp.example.com/mcp', authMode: 'oauth', clientId: 'def' } },
  });
  assert.equal(response.code, 200, JSON.stringify(response));
  assert.equal(response.plan.entries[0].keepsSession, false);
  assert.deepEqual(reloaded.state().workspaceTokens, {}, 'the old client cannot keep its tokens');
  assert.equal(ws.read().mcpServers.github.clientId, 'def');
});

it('prunes a workspace session when an edit deletes an entry from an unloaded workspace', async (t) => {
  const dir = join(scratch, 'ws-unloaded');
  mkdirSync(join(dir, '.dsh/dshmm'), { recursive: true });
  const canonical = realpathSync(dir);
  const oauth = { authorizationServer: 'https://auth.example.com', tokens: { access_token: 'x' } };
  const h = mount(t, { servers: [], workspaceTokens: { [`${canonical}\ngone`]: { oauth } } });
  const ws = h.workspace('unloaded', {
    mcpServers: { gone: { type: 'http', url: 'https://gone.test/mcp', authMode: 'oauth' } },
  });
  const reloaded = h;
  const response = await reloaded.request('POST', '/import', {
    scope: 'workspace',
    path: ws.dir,
    mode: 'edit',
    mcpServers: {},
  });
  assert.equal(response.code, 200, JSON.stringify(response));
  assert.deepEqual(reloaded.state().workspaceTokens, {}, 'the deleted server leaves no session behind');
  assert.deepEqual(ws.read().mcpServers, {});
});

it('drops the stored session when a profile edit clears the client id', async (t) => {
  const oauth = { authorizationServer: 'https://auth.example.com', tokens: { access_token: 'old' } };
  const row = { id: 'g1', name: 'github', type: 'http', authMode: 'oauth', url: 'https://api.github.com/mcp', clientId: 'abc', oauth };
  const h = mount(t, { servers: [row] });
  const response = await h.request('PUT', '/servers/g1', {
    name: 'github',
    type: 'http',
    url: 'https://api.github.com/mcp',
    authMode: 'oauth',
    clientId: '',
  });
  assert.equal(response.code, 200, JSON.stringify(response));
  assert.equal(h.state().servers[0].clientId, undefined);
  assert.equal(h.state().servers[0].oauth, undefined, 'an explicitly cleared identity drops the session');
});

it('rejects a locked document that also names another server', async (t) => {
  const h = mount(t);
  const response = await h.request('POST', '/import', {
    scope: 'global',
    mode: 'edit',
    lockedName: 'github',
    mcpServers: { github: httpServer(), unity: httpServer({ url: 'http://localhost:8090/' }) },
  });
  assert.equal(response.code, 400);
  assert.equal(response.plan.entries.find((item) => item.name === 'unity').action, 'invalid');
  assert.equal(response.plan.entries.find((item) => item.name === 'github').action, 'new');
  assert.deepEqual(h.state().servers, []);
});

it('rejects a workspace file whose mcpServers is not an object', async (t) => {
  const h = mount(t);
  const ws = h.workspace('array', { mcpServers: [] });
  const response = await h.request('POST', '/import', {
    scope: 'workspace',
    path: ws.dir,
    mode: 'edit',
    mcpServers: {},
  });
  assert.equal(response.code, 400);
  assert.match(response.error, /mcpServers/);
});
