/**
 * End-to-end OAuth callback flows (v0.18.0).
 *
 * These tests drive real HTTP callbacks against the loopback listener the
 * plugin opens: authorization, listener readiness, sharing, concurrency,
 * replay rejection, cancellation and teardown.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, beforeEach, it } from 'node:test';

const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-mm-callback-'));
process.env.HOME = scratchHome;
process.env.USERPROFILE = scratchHome;
process.env.DSH_HOME = join(scratchHome, '.dsh');
after(() => rmSync(scratchHome, { recursive: true, force: true }));
assert.equal(homedir(), scratchHome, 'homedir() must resolve to the scratch home');
mkdirSync(join(scratchHome, '.dsh'), { recursive: true });
const statePath = join(scratchHome, '.dsh', 'mcp-manager.json');

const { apply } = await import('../lib/index.js');
const { canBindPort, deliverCallback, freePort, redirectOf, startAuthorizationStub, stateOf, waitFor } = await import('./helpers/oauth-harness.js');

const testDisposers = [];
beforeEach(() => writeFileSync(statePath, JSON.stringify({ servers: [] })));
afterEach(() => { for (const dispose of testDisposers.splice(0).reverse()) dispose(); });

const state = () => JSON.parse(readFileSync(statePath, 'utf8'));
const stored = (id) => state().servers.find((server) => server.id === id);

function makeCtx(config = {}, { workspacePaths = [], agents = null } = {}) {
  let handler;
  const cleanup = [];
  const runEffect = (fn) => {
    const dispose = fn();
    if (typeof dispose === 'function') cleanup.push(dispose);
    return () => {};
  };
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: { guard: () => () => {}, register: () => () => {}, restrict: () => () => {}, execute: async () => ({}) },
    webServer: { register: (route) => { handler = route.handler; return () => {}; } },
    get: (name) => (name === 'workspaceRegistry' && workspacePaths.length
      ? { list: () => workspacePaths.map((path) => ({ path })) }
      : undefined),
    on: () => () => {},
    inject: (names, callback) => {
      if (typeof callback !== 'function') return { dispose: () => {} };
      if (names.includes('webServer')) callback({ webServer: ctx.webServer, get: () => undefined, effect: runEffect });
      if (names.includes('agents') && agents) callback({ agents, get: () => undefined, effect: runEffect });
      return { dispose: () => {} };
    },
    effect: runEffect,
  };
  apply(ctx, config);
  const dispose = async () => { for (const fn of cleanup.splice(0).reverse()) { try { await fn(); } catch {} } };
  testDisposers.push(dispose);
  return { handler, dispose };
}

async function request(handler, method, path, body, headers = {}) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = {
    method,
    url: path,
    headers: { host: '127.0.0.1:3080', ...headers },
    async *[Symbol.asyncIterator]() { for (const chunk of payload) yield chunk; },
  };
  const res = {
    code: 0,
    body: '',
    writeHead(code) { this.code = code; },
    end(chunk) { this.body = chunk ?? ''; },
  };
  await handler(req, res);
  let json;
  try { json = res.body ? JSON.parse(res.body) : undefined; } catch {}
  return { code: res.code, json, text: String(res.body) };
}

function makeAgents() {
  return {
    create(options) {
      const agent = {
        id: `agent-${options.cwd}`,
        session: { header: { cwd: options.cwd } },
        ctx: { tools: { register: () => () => {}, restrict: () => () => {}, guard: () => () => {} } },
      };
      const ready = Promise.resolve(options.setup({ effect: () => () => {} }, agent));
      return { agent, ready, dispose() {} };
    },
    resume(options) { return this.create(options); },
  };
}

async function createServerFor(handler, stub, name = 'fixture') {
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', { name, type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  assert.equal(created.code, 201, created.text);
  return created.json.server.id;
}

it('binds the listener before returning the authorization URL and releases it after the flow', async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const { handler } = makeCtx();

  const id = await createServerFor(handler, stub);
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(auth.code, 200, auth.text);
  const redirect = redirectOf(auth.json.authorizeUrl);
  assert.match(redirect, /^http:\/\/localhost:\d+\/callback$/);
  assert.equal(auth.json.authorizeUrl.includes(id), false, 'the callback URL carries no server id');
  // Readiness: the port in the URL already answers.
  const probe = await fetch(new URL(redirect).origin, { method: 'GET' });
  await probe.text();
  assert.equal(probe.status, 404, 'the listener is up and only knows registered paths');

  const callback = await deliverCallback(auth.json.authorizeUrl);
  assert.match(callback.text, /Authorized/);
  const view = (await request(handler, 'GET', '/mcp-manager/api/servers')).json.servers.find((server) => server.id === id);
  assert.equal(view.status, 'connected');
  assert.equal(stored(id).oauth.tokens.access_token, 'access-1');
  assert.equal(stub.forms[0].get('redirect_uri'), redirect, 'the exchange replays the pinned URI');

  const port = new URL(redirect).port;
  await waitFor(() => canBindPort(port), 'the listener must release its port after the flow');
});

it('shares one listener between two servers and routes each callback by state', async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const { handler } = makeCtx();

  const first = await createServerFor(handler, stub, 'share-one');
  const second = await createServerFor(handler, stub, 'share-two');
  const firstAuth = await request(handler, 'POST', `/mcp-manager/api/servers/${first}/auth`);
  const secondAuth = await request(handler, 'POST', `/mcp-manager/api/servers/${second}/auth`);
  assert.equal(new URL(redirectOf(firstAuth.json.authorizeUrl)).port, new URL(redirectOf(secondAuth.json.authorizeUrl)).port,
    'compatible flows share one listener');

  // Completion order is what the stub counts, so the second flow to finish gets
  // the second token: each connection keeps its own pair.
  assert.match((await deliverCallback(secondAuth.json.authorizeUrl)).text, /Authorized/);
  assert.match((await deliverCallback(firstAuth.json.authorizeUrl)).text, /Authorized/);
  assert.equal(stored(second).oauth.tokens.access_token, 'access-1');
  assert.equal(stored(first).oauth.tokens.access_token, 'access-2');
  assert.equal(stub.forms.length, 2);
  assert.equal(stub.forms[0].get('redirect_uri'), redirectOf(secondAuth.json.authorizeUrl));
});

it('keeps concurrent flows for the same server independent and lets the last exchange win', async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const { handler } = makeCtx();

  const id = await createServerFor(handler, stub);
  const first = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  const second = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.notEqual(stateOf(first.json.authorizeUrl), stateOf(second.json.authorizeUrl));

  assert.match((await deliverCallback(first.json.authorizeUrl)).text, /Authorized/);
  assert.equal(stored(id).oauth.tokens.access_token, 'access-1');
  // The sibling flow was not invalidated by the first completion.
  assert.match((await deliverCallback(second.json.authorizeUrl)).text, /Authorized/);
  assert.equal(stored(id).oauth.tokens.access_token, 'access-2', 'the most recent exchange wins');
});

it('rejects an unknown state and a replayed callback without a token request', async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const { handler } = makeCtx();

  const id = await createServerFor(handler, stub);
  const first = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  // A second flow keeps the listener open after the first one completes, so the
  // replay reaches the router instead of a closed port.
  const second = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);

  const unknown = await deliverCallback(first.json.authorizeUrl, { state: 'not-a-state' });
  assert.match(unknown.text, /does not match any pending authorization/);
  assert.equal(stub.forms.length, 0, 'an unknown state never exchanges a code');

  assert.match((await deliverCallback(first.json.authorizeUrl)).text, /Authorized/);
  assert.equal(stub.forms.length, 1);
  const replay = await deliverCallback(first.json.authorizeUrl);
  assert.match(replay.text, /already completed/);
  assert.equal(stub.forms.length, 1, 'a replay never exchanges twice');

  // The sibling flow is unaffected by the consumed one.
  assert.match((await deliverCallback(second.json.authorizeUrl)).text, /Authorized/);
  assert.equal(stub.forms.length, 2);
});

it('releases the flow when the provider returns an error', async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const { handler } = makeCtx();

  const id = await createServerFor(handler, stub);
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  const port = new URL(redirectOf(auth.json.authorizeUrl)).port;
  const denied = await deliverCallback(auth.json.authorizeUrl, { error: 'access_denied' });
  assert.match(denied.text, /access_denied/);
  assert.equal(stub.forms.length, 0);
  const view = (await request(handler, 'GET', '/mcp-manager/api/servers')).json.servers.find((server) => server.id === id);
  assert.equal(view.status, 'needs-auth');
  await waitFor(() => canBindPort(port), 'the listener must be released after a provider error');
});

it('honours a fixed callback configuration and reports a busy port without falling back', async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const { handler } = makeCtx();

  const port = await freePort();
  const saved = await request(handler, 'PUT', '/mcp-manager/api/settings/callback', {
    mode: 'fixed', host: 'localhost', port, path: '/callback',
  });
  assert.equal(saved.code, 200, saved.text);
  assert.equal(saved.json.oauthCallback.port, String(port));

  const id = await createServerFor(handler, stub);
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(auth.code, 200, auth.text);
  assert.equal(redirectOf(auth.json.authorizeUrl), `http://localhost:${port}/callback`);
  assert.match((await deliverCallback(auth.json.authorizeUrl)).text, /Authorized/);
  await waitFor(() => canBindPort(port), 'the fixed port is released after the flow');

  // Hold the port and try again: the attempt must fail loudly and not pick
  // another port.
  const holder = createServer();
  await new Promise((resolve) => holder.listen({ host: '127.0.0.1', port }, resolve));
  try {
    const second = await createServerFor(handler, stub, 'busy');
    const failed = await request(handler, 'POST', `/mcp-manager/api/servers/${second}/auth`);
    assert.equal(failed.code, 500, failed.text);
    assert.match(failed.json.error, new RegExp(`port ${port} is already in use`));
    const status = (await request(handler, 'GET', '/mcp-manager/api/settings')).json.callbackStatus;
    assert.deepEqual(status.listeners, [], 'no fallback listener is opened');
    assert.match(status.lastError, new RegExp(`port ${port}`));
  } finally {
    await new Promise((resolve) => holder.close(resolve));
  }
});

it('cancels a pending flow when the server is deleted or disabled', async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const { handler } = makeCtx();

  const deleted = await createServerFor(handler, stub, 'deleted');
  const deleteAuth = await request(handler, 'POST', `/mcp-manager/api/servers/${deleted}/auth`);
  const deletePort = new URL(redirectOf(deleteAuth.json.authorizeUrl)).port;
  assert.equal((await request(handler, 'DELETE', `/mcp-manager/api/servers/${deleted}`)).code, 200);
  await waitFor(() => canBindPort(deletePort), 'deleting the server releases its listener');

  const disabled = await createServerFor(handler, stub, 'disabled');
  const disableAuth = await request(handler, 'POST', `/mcp-manager/api/servers/${disabled}/auth`);
  const disablePort = new URL(redirectOf(disableAuth.json.authorizeUrl)).port;
  assert.equal((await request(handler, 'POST', `/mcp-manager/api/servers/${disabled}/enabled`, { enabled: false })).code, 200);
  await waitFor(() => canBindPort(disablePort), 'disabling the server releases its listener');
});

it('closes every listener on plugin unload', async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const { handler, dispose } = makeCtx();

  const id = await createServerFor(handler, stub);
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  const port = new URL(redirectOf(auth.json.authorizeUrl)).port;
  await dispose();
  await waitFor(() => canBindPort(port), 'unload must close the listener and free the port');
});

it('keeps the session when the redirect changes and re-registers on the next authentication', async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const { handler } = makeCtx();

  const id = await createServerFor(handler, stub, 'lifecycle');
  assert.match((await deliverCallback((await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`)).json.authorizeUrl)).text, /Authorized/);
  const firstRedirect = stored(id).oauth.redirect;
  assert.equal(stub.registrations.length, 1);
  assert.equal(stored(id).oauth.tokens.access_token, 'access-1');

  const port = await freePort();
  const saved = await request(handler, 'PUT', `/mcp-manager/api/servers/${id}`, {
    name: 'lifecycle', type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: `http://localhost:${port}`,
  });
  assert.equal(saved.code, 200, saved.text);
  assert.equal(stored(id).oauth.tokens.access_token, 'access-1', 'saving a redirect never signs the server out');
  assert.equal(stored(id).oauth.redirect, firstRedirect);
  assert.equal(stub.registrations.length, 1, 'a save never re-registers');

  // The kept registration still refreshes a revoked access token.
  stub.revoked.add('access-1');
  assert.equal((await request(handler, 'POST', `/mcp-manager/api/servers/${id}/connect`)).code, 200);
  assert.equal(stored(id).oauth.tokens.access_token, 'access-2');

  const reauth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(reauth.code, 200, reauth.text);
  assert.equal(redirectOf(reauth.json.authorizeUrl), `http://localhost:${port}/callback`);
  assert.equal(stub.registrations.length, 2, 'a new redirect needs a new registration');
  assert.equal(stored(id).oauth.tokens, undefined, 'the replaced client cannot refresh the old pair');
});

it('never re-registers a manually configured client', async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const { handler } = makeCtx();

  const port = await freePort();
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', {
    name: 'manual', type: 'http', url: stub.mcpUrl, authMode: 'oauth', clientId: 'manual-client', redirectUrl: `http://localhost:${port}`,
  });
  const id = created.json.server.id;
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(auth.code, 200, auth.text);
  assert.equal(new URL(auth.json.authorizeUrl).searchParams.get('client_id'), 'manual-client');
  assert.equal(redirectOf(auth.json.authorizeUrl), `http://localhost:${port}/callback`);
  assert.equal(stub.registrations.length, 0);
  assert.match((await deliverCallback(auth.json.authorizeUrl)).text, /Authorized/);
});

it('adopts a redirect override hand-edited into the state file', async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const { handler } = makeCtx();

  const id = await createServerFor(handler, stub, 'external');
  const port = await freePort();
  const disk = state();
  disk.servers.find((server) => server.id === id).redirectUrl = `http://localhost:${port}/gh`;
  writeFileSync(statePath, JSON.stringify(disk, null, 2));

  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(auth.code, 200, auth.text);
  assert.equal(redirectOf(auth.json.authorizeUrl), `http://localhost:${port}/gh`);
});

it('honours, preserves and reloads a workspace entry override', async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const workspaceDir = join(scratchHome, 'workspace-with-override');
  mkdirSync(join(workspaceDir, '.dsh', 'dshmm'), { recursive: true });
  const configFile = join(workspaceDir, '.dsh', 'dshmm', 'mcp.json');
  const port = await freePort();
  const writeConfig = (value) => writeFileSync(configFile, JSON.stringify(value, null, 2));
  writeConfig({ mcpServers: { wsff: { type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: `http://localhost:${port}` } } });
  const agents = makeAgents();
  const { handler } = makeCtx({}, { workspacePaths: [workspaceDir], agents });

  const row = (await request(handler, 'GET', '/mcp-manager/api/workspaces')).json.workspaces
    .find((ws) => ws.path === workspaceDir).servers.find((server) => server.name === 'wsff');
  assert.equal(row.redirectUrl, `http://localhost:${port}`);
  assert.equal(row.redirectUri, `http://localhost:${port}/callback`);

  const edited = await request(handler, 'PUT', '/mcp-manager/api/workspaces/servers', {
    path: workspaceDir, oldName: 'wsff', name: 'wsff', type: 'http', url: stub.mcpUrl, authMode: 'oauth',
  });
  assert.equal(edited.code, 200, edited.text);
  assert.equal(JSON.parse(readFileSync(configFile, 'utf8')).mcpServers.wsff.redirectUrl, `http://localhost:${port}`);

  const secondPort = await freePort();
  writeConfig({ mcpServers: { wsff: { type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: `http://localhost:${secondPort}/auth` } } });
  const reloaded = (await request(handler, 'GET', '/mcp-manager/api/workspaces')).json.workspaces
    .find((ws) => ws.path === workspaceDir).servers.find((server) => server.name === 'wsff');
  assert.equal(reloaded.redirectUri, `http://localhost:${secondPort}/auth`);

  const { ready } = agents.create({ cwd: workspaceDir });
  await ready;
  const auth = await request(handler, 'POST', '/mcp-manager/api/workspaces/auth', { path: workspaceDir, name: 'wsff' });
  assert.equal(auth.code, 200, auth.text);
  assert.equal(redirectOf(auth.json.authorizeUrl), `http://localhost:${secondPort}/auth`);
  assert.match((await deliverCallback(auth.json.authorizeUrl)).text, /Authorized/);
  const persisted = JSON.parse(readFileSync(statePath, 'utf8'));
  const slot = Object.entries(persisted.workspaceTokens ?? {})
    .find(([, value]) => value.oauth?.tokens?.access_token);
  assert.ok(slot, 'the workspace token slot is persisted');
});

it('reports an unservable stored override instead of falling back to an automatic port', async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const { handler } = makeCtx();

  const id = await createServerFor(handler, stub, 'legacy');
  const disk = state();
  // Written by an earlier version that allowed an allowlisted public origin.
  disk.servers.find((server) => server.id === id).redirectUrl = 'https://harness.example.com/callback';
  writeFileSync(statePath, JSON.stringify(disk, null, 2));

  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(auth.code, 500, auth.text);
  assert.match(auth.json.error, /plain HTTP/);
  assert.equal(stored(id).redirectUrl, 'https://harness.example.com/callback', 'the stored value is not rewritten');
  const view = (await request(handler, 'GET', '/mcp-manager/api/servers')).json.servers.find((server) => server.id === id);
  assert.equal(view.redirectWarning, 'invalid');
  assert.equal(view.redirectUri, '');
});
