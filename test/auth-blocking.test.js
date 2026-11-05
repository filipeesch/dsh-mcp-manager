/**
 * Blocking tool calls until a reauthorization completes (v0.21.0).
 *
 * Every case drives the real host half over a loopback MCP + authorization
 * server: the call parks, the conversation-facing listing reports it, and the
 * call either resumes or fails with the actionable error.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, it } from 'node:test';

const scratch = mkdtempSync(join(tmpdir(), 'dsh-mm-blocking-'));
process.env.HOME = scratch;
process.env.USERPROFILE = scratch;
process.env.DSH_HOME = join(scratch, '.dsh');
mkdirSync(process.env.DSH_HOME, { recursive: true });
const statePath = join(process.env.DSH_HOME, 'mcp-manager.json');

const mod = await import('../lib/index.js');
const { mountPlugin } = await import('./helpers/plugin-harness.js');
const { canBindPort, deliverCallback, redirectOf, startAuthorizationStub, waitFor } = await import('./helpers/oauth-harness.js');

after(() => {
  delete process.env.MM_STATIC_TOKEN;
  rmSync(scratch, { recursive: true, force: true });
});
beforeEach(() => writeFileSync(statePath, JSON.stringify({ servers: [] })));

const state = () => JSON.parse(readFileSync(statePath, 'utf8'));
const stored = (id) => state().servers.find((server) => server.id === id);

function mount(t, config) {
  const app = mountPlugin(mod, { config });
  t.after(() => app.dispose());
  return app;
}

async function connectServer(app, stub, name = 'database') {
  const created = await app.request('POST', '/servers', { name, type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  assert.equal(created.status, 201, JSON.stringify(created));
  const auth = await app.request('POST', `/servers/${created.server.id}/auth`);
  assert.equal(auth.status, 200, JSON.stringify(auth));
  assert.match((await deliverCallback(auth.authorizeUrl)).text, /Authorized/);
  return created.server.id;
}

function revokeCurrentToken(stub, id) {
  stub.revoked.add(stored(id).oauth.tokens.access_token);
}

async function attention(app) {
  return (await app.request('GET', '/attention')).items;
}

it('parks a revoked call and resumes it with the same arguments after the authorization', { timeout: 15000 }, async (t) => {
  const stub = await startAuthorizationStub({ failRefresh: true });
  t.after(() => stub.close());
  const app = mount(t);
  const id = await connectServer(app, stub);
  revokeCurrentToken(stub, id);

  const definition = app.tool('mcp__database__echo');
  const call = definition.execute({ ping: 'value-1' }, { agent: { id: 'session-a' } });
  call.catch(() => {});
  await waitFor(async () => (await attention(app)).length === 1, 'the call parks');

  const auth = await app.request('POST', `/servers/${id}/auth`);
  assert.equal(auth.status, 200, JSON.stringify(auth));
  assert.match((await deliverCallback(auth.authorizeUrl)).text, /Authorized/);

  const result = await call;
  assert.equal(result.isError, false);
  assert.equal(stub.toolCalls.length, 1, 'the retry is the only accepted call');
  assert.deepEqual(stub.toolCalls[0], { name: 'echo', arguments: { ping: 'value-1' } });
  await waitFor(async () => (await attention(app)).length === 0, 'the listing empties after the resume');
});

it('ends the call at the configured budget with the actionable error', { timeout: 15000 }, async (t) => {
  const stub = await startAuthorizationStub({ failRefresh: true });
  t.after(() => stub.close());
  const app = mount(t, { authWaitMs: 1000 });
  const id = await connectServer(app, stub);
  revokeCurrentToken(stub, id);

  const definition = app.tool('mcp__database__echo');
  const started = Date.now();
  await assert.rejects(
    definition.execute({}, { agent: { id: 'session-a' } }),
    (error) => {
      assert.match(error.message, /MCP server "database"/);
      assert.match(error.message, /call was not executed/);
      assert.match(error.message, /within 1s/);
      assert.match(error.message, /conversation banner/);
      return true;
    },
  );
  assert.ok(Date.now() - started < 5000, 'the budget must end the wait');
  await waitFor(async () => (await attention(app)).length === 0, 'the listing is empty after the timeout');
});

it('cancelling the wait releases the pending authorization flow', { timeout: 15000 }, async (t) => {
  const stub = await startAuthorizationStub({ failRefresh: true });
  t.after(() => stub.close());
  const app = mount(t);
  const id = await connectServer(app, stub);
  revokeCurrentToken(stub, id);

  const definition = app.tool('mcp__database__echo');
  const call = definition.execute({}, { agent: { id: 'session-a' } });
  call.catch(() => {});
  await waitFor(async () => (await attention(app)).length === 1, 'the call parks');

  const auth = await app.request('POST', `/servers/${id}/auth`);
  const port = new URL(redirectOf(auth.authorizeUrl)).port;
  const canceled = await app.request('POST', '/attention/cancel', { sessionId: 'session-a', serverId: id });
  assert.equal(canceled.canceled, 1);
  assert.equal(canceled.released, true);
  await assert.rejects(call, /authorization was cancelled/);
  await waitFor(() => canBindPort(Number(port)), 'the callback listener is released');
});

it('aborting the turn settles the wait as interrupted and releases the flow', { timeout: 15000 }, async (t) => {
  const stub = await startAuthorizationStub({ failRefresh: true });
  t.after(() => stub.close());
  const app = mount(t);
  const id = await connectServer(app, stub);
  revokeCurrentToken(stub, id);

  const controller = new AbortController();
  const definition = app.tool('mcp__database__echo');
  const call = definition.execute({}, { agent: { id: 'session-a' }, signal: controller.signal });
  call.catch(() => {});
  await waitFor(async () => (await attention(app)).length === 1, 'the call parks');

  const auth = await app.request('POST', `/servers/${id}/auth`);
  const port = new URL(redirectOf(auth.authorizeUrl)).port;
  controller.abort();
  await assert.rejects(call, (error) => error.name === 'AbortError');
  await waitFor(async () => (await attention(app)).length === 0, 'the listing is empty after the abort');
  await waitFor(() => canBindPort(Number(port)), 'the callback listener is released');
});

it('settles a waiting call when the server is disabled', { timeout: 15000 }, async (t) => {
  const stub = await startAuthorizationStub({ failRefresh: true });
  t.after(() => stub.close());
  const app = mount(t);
  const id = await connectServer(app, stub);
  revokeCurrentToken(stub, id);

  const definition = app.tool('mcp__database__echo');
  const call = definition.execute({}, { agent: { id: 'session-a' } });
  call.catch(() => {});
  await waitFor(async () => (await attention(app)).length === 1, 'the call parks');

  const disabled = await app.request('POST', `/servers/${id}/enabled`, { enabled: false });
  assert.equal(disabled.status, 200);
  await assert.rejects(call, /was disabled while the call waited/);
  await waitFor(async () => (await attention(app)).length === 0, 'the listing is empty after the disable');
});

it('parks and resumes a workspace server through the workspace authorization', { timeout: 15000 }, async (t) => {
  const stub = await startAuthorizationStub({ failRefresh: true });
  t.after(() => stub.close());
  const workspace = mkdtempSync(join(scratch, 'workspace-'));
  mkdirSync(join(workspace, '.dsh', 'dshmm'), { recursive: true });
  writeFileSync(join(workspace, '.dsh', 'dshmm', 'mcp.json'), JSON.stringify({ mcpServers: { database: { url: stub.mcpUrl, authMode: 'oauth' } } }));

  const canonical = realpathSync(workspace);
  const app = mount(t);
  const workspaceAgent = await app.createAgent(workspace);
  const auth = await app.request('POST', '/workspaces/auth', { path: workspace, name: 'database' });
  assert.equal(auth.status, 200, JSON.stringify(auth));
  assert.match((await deliverCallback(auth.authorizeUrl)).text, /Authorized/);

  const definition = workspaceAgent.tools.get('mcp__database__echo');
  assert.ok(definition, 'the workspace server registers its tools on the agent');
  const token = state().workspaceTokens[`${canonical}\ndatabase`].oauth.tokens.access_token;
  stub.revoked.add(token);

  const call = definition.execute({ from: 'workspace' }, { agent: workspaceAgent.agent, signal: undefined });
  call.catch(() => {});
  await waitFor(async () => (await attention(app)).length === 1, 'the workspace call parks');
  const item = (await attention(app))[0];
  assert.equal(item.scope, 'workspace');
  assert.equal(item.workspacePath, canonical);
  assert.equal(item.sessionId, workspaceAgent.agent.id);

  const resumed = await app.request('POST', '/workspaces/auth', { path: workspace, name: 'database' });
  assert.equal(resumed.status, 200, JSON.stringify(resumed));
  assert.match((await deliverCallback(resumed.authorizeUrl)).text, /Authorized/);
  const result = await call;
  assert.equal(result.isError, false);
  await waitFor(async () => (await attention(app)).length === 0, 'the listing empties after the workspace resume');
});

it('fails a static-token server immediately without a banner entry', { timeout: 15000 }, async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  process.env.MM_STATIC_TOKEN = 'access-1';
  t.after(() => { delete process.env.MM_STATIC_TOKEN; });
  const app = mount(t);

  const created = await app.request('POST', '/servers', { name: 'internal', type: 'http', url: stub.mcpUrl, authMode: 'static', tokenEnv: 'MM_STATIC_TOKEN' });
  assert.equal(created.status, 201, JSON.stringify(created));
  const id = created.server.id;
  await waitFor(async () => {
    const connected = await app.request('GET', '/servers');
    return connected.servers.find((server) => server.id === id)?.status === 'connected';
  }, 'the static server connects with its valid token');

  process.env.MM_STATIC_TOKEN = 'not-a-token';
  const definition = app.tool('mcp__internal__echo');
  await assert.rejects(
    definition.execute({}, { agent: { id: 'session-a' } }),
    (error) => {
      assert.match(error.message, /does not use browser authorization/);
      assert.match(error.message, /Settings → MCP/);
      assert.doesNotMatch(error.message, /conversation banner/);
      return true;
    },
  );
  assert.deepEqual(await attention(app), []);
});

it('does not wait when the server never connected', { timeout: 15000 }, async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const app = mount(t);
  const created = await app.request('POST', '/servers', { name: 'database', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  assert.equal(created.status, 201, JSON.stringify(created));
  const id = created.server.id;
  const connected = await app.request('POST', `/servers/${id}/connect`);
  assert.equal(connected.status, 200, JSON.stringify(connected));
  assert.equal(connected.server.status, 'needs-auth');
  assert.deepEqual(await attention(app), [], 'a connection-only failure never creates a waiting call');
});

it('resumes the waiting calls of two sessions from one authorization', { timeout: 15000 }, async (t) => {
  const stub = await startAuthorizationStub({ failRefresh: true });
  t.after(() => stub.close());
  const app = mount(t);
  const id = await connectServer(app, stub);
  revokeCurrentToken(stub, id);

  const definition = app.tool('mcp__database__echo');
  const first = definition.execute({ session: 'a' }, { agent: { id: 'session-a' } });
  const second = definition.execute({ session: 'b' }, { agent: { id: 'session-b' } });
  first.catch(() => {});
  second.catch(() => {});
  await waitFor(async () => (await attention(app)).length === 2, 'both sessions wait');

  const auth = await app.request('POST', `/servers/${id}/auth`);
  assert.equal(auth.status, 200, JSON.stringify(auth));
  assert.match((await deliverCallback(auth.authorizeUrl)).text, /Authorized/);
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((result) => result.isError), [false, false]);
  assert.equal(stub.toolCalls.length, 2, 'each waiting call is retried once');
  await waitFor(async () => (await attention(app)).length === 0, 'the listing empties');
});

it('waits on an insufficient-scope rejection', { timeout: 15000 }, async (t) => {
  const stub = await startAuthorizationStub({ scopeChallenge: true });
  t.after(() => stub.close());
  const app = mount(t);
  await connectServer(app, stub);
  const definition = app.tool('mcp__database__echo');
  const call = definition.execute({}, { agent: { id: 'session-a' } });
  call.catch(() => {});
  await waitFor(async () => (await attention(app)).length === 1, 'the scope rejection waits');
  const item = (await attention(app))[0];
  assert.match(item.reason, /insufficient scope/);
  assert.match(item.reason, /feed:read/);
  await app.request('POST', '/attention/cancel', { sessionId: 'session-a', serverId: item.serverId });
  await assert.rejects(call, /authorization was cancelled/);
});

it('repairs a revoked SSE call with a refresh instead of waiting', { timeout: 15000 }, async (t) => {
  const stub = await startAuthorizationStub({ sse: true });
  t.after(() => stub.close());
  const app = mount(t);
  const id = await connectServer(app, stub);
  revokeCurrentToken(stub, id);

  const definition = app.tool('mcp__database__echo');
  const result = await definition.execute({ over: 'sse' }, { agent: { id: 'session-a' } });
  assert.equal(result.isError, false);
  assert.ok(stub.forms.some((form) => form.get('grant_type') === 'refresh_token'), 'the SSE POST path refreshes before waiting');
  assert.deepEqual(await attention(app), [], 'a repaired rejection does not create a waiting call');
});
