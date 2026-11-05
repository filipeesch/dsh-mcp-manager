/**
 * Attention API and listing (v0.21.0).
 *
 * A revoked token whose refresh cannot repair it parks a real tool call; the
 * conversation-facing listing then reports it, stays read-only, and the cancel
 * endpoint releases exactly the waiting session.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, it } from 'node:test';

const scratch = mkdtempSync(join(tmpdir(), 'dsh-mm-attention-'));
process.env.HOME = scratch;
process.env.USERPROFILE = scratch;
process.env.DSH_HOME = join(scratch, '.dsh');
mkdirSync(process.env.DSH_HOME, { recursive: true });
const statePath = join(process.env.DSH_HOME, 'mcp-manager.json');

const mod = await import('../lib/index.js');
const { mountPlugin } = await import('./helpers/plugin-harness.js');
const { canBindPort, deliverCallback, redirectOf, startAuthorizationStub, waitFor } = await import('./helpers/oauth-harness.js');

after(() => rmSync(scratch, { recursive: true, force: true }));
beforeEach(() => writeFileSync(statePath, JSON.stringify({ servers: [] })));

const state = () => JSON.parse(readFileSync(statePath, 'utf8'));
const stored = (id) => state().servers.find((server) => server.id === id);

function mount(t) {
  const app = mountPlugin(mod);
  t.after(() => app.dispose());
  return app;
}

async function connectServer(app, stub, name = 'database') {
  const created = await app.request('POST', '/servers', { name, type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  assert.equal(created.status, 201, JSON.stringify(created));
  const id = created.server.id;
  const auth = await app.request('POST', `/servers/${id}/auth`);
  assert.equal(auth.status, 200, JSON.stringify(auth));
  const callback = await deliverCallback(auth.authorizeUrl);
  assert.match(callback.text, /Authorized/);
  return id;
}

function revokeCurrentToken(stub, id) {
  const token = stored(id).oauth.tokens.access_token;
  stub.revoked.add(token);
  return token;
}

async function waitingTool(app, name = 'database') {
  const definition = app.tool(`mcp__${name}__echo`);
  assert.ok(definition, `the server must register mcp__${name}__echo`);
  return definition;
}

it('lists a waiting call, stays read-only, and cancels it', async (t) => {
  const stub = await startAuthorizationStub({ failRefresh: true });
  t.after(() => stub.close());
  const app = mount(t);
  const id = await connectServer(app, stub);
  const token = revokeCurrentToken(stub, id);

  const definition = await waitingTool(app);
  const call = definition.execute({}, { agent: { id: 'session-a' } });
  call.catch(() => {});
  await waitFor(async () => (await app.request('GET', '/attention')).items.length === 1, 'the waiting call is listed');

  const logsBefore = (await app.request('GET', `/servers/${id}/logs`)).logs;
  const listing = await app.request('GET', '/attention');
  assert.equal(listing.status, 200);
  assert.equal(listing.items.length, 1);
  const item = listing.items[0];
  assert.equal(item.serverId, id);
  assert.equal(item.sessionId, 'session-a');
  assert.equal(item.scope, 'global');
  assert.equal(item.workspacePath, '');
  assert.equal(item.name, 'database');
  assert.equal(item.phase, 'needs-auth');
  assert.equal(item.pending, 1);
  assert.equal(item.error, '');
  assert.ok(item.remainingMs > 0 && item.remainingMs <= 120000);
  assert.equal(typeof item.reason, 'string');
  assert.equal(JSON.stringify(listing).includes(token), false, 'the listing never carries the token');
  assert.equal(JSON.stringify(listing).includes('refresh-'), false, 'the listing never carries the refresh token');
  assert.equal(JSON.stringify(listing).includes('http'), false, 'the listing never carries an authorization URL');
  const logsAfter = (await app.request('GET', `/servers/${id}/logs`)).logs;
  assert.deepEqual(logsAfter, logsBefore, 'reading the listing must not record anything');

  const canceled = await app.request('POST', '/attention/cancel', { sessionId: 'session-a', serverId: id });
  assert.deepEqual(canceled, { status: 200, canceled: 1, released: false });
  await assert.rejects(call, /needs authentication and the call was not executed: the authorization was cancelled/);
  await waitFor(async () => (await app.request('GET', '/attention')).items.length === 0, 'the listing is empty after the cancel');
});

it('reports the authorizing phase and the last failed attempt while the call keeps waiting', async (t) => {
  const stub = await startAuthorizationStub({ failRefresh: true });
  t.after(() => stub.close());
  const app = mount(t);
  const id = await connectServer(app, stub);
  revokeCurrentToken(stub, id);

  const definition = await waitingTool(app);
  const call = definition.execute({}, { agent: { id: 'session-a' } });
  call.catch(() => {});
  await waitFor(async () => (await app.request('GET', '/attention')).items.length === 1, 'the waiting call is listed');

  const auth = await app.request('POST', `/servers/${id}/auth`);
  assert.equal(auth.status, 200, JSON.stringify(auth));
  await waitFor(async () => (await app.request('GET', '/attention')).items[0]?.phase === 'authorizing', 'the phase follows the pending flow');

  const failed = await deliverCallback(auth.authorizeUrl, { error: 'access_denied' });
  assert.match(failed.text, /access_denied/);
  await waitFor(async () => (await app.request('GET', '/attention')).items[0]?.error.includes('access_denied') === true, 'the failure is reported');

  const waiting = (await app.request('GET', '/attention')).items[0];
  assert.equal(waiting.pending, 1, 'a failed attempt does not settle the call');
  assert.equal(waiting.phase, 'needs-auth');

  const canceled = await app.request('POST', '/attention/cancel', { sessionId: 'session-a', serverId: id });
  assert.equal(canceled.canceled, 1);
  await assert.rejects(call, /authorization was cancelled/);
});

it('cancels only the session that asks', async (t) => {
  const stub = await startAuthorizationStub({ failRefresh: true });
  t.after(() => stub.close());
  const app = mount(t);
  const id = await connectServer(app, stub);
  revokeCurrentToken(stub, id);

  const definition = await waitingTool(app);
  const first = definition.execute({}, { agent: { id: 'session-a' } });
  const second = definition.execute({}, { agent: { id: 'session-b' } });
  first.catch(() => {});
  second.catch(() => {});
  await waitFor(async () => (await app.request('GET', '/attention')).items.length === 2, 'both sessions are listed');

  // A flow started while both wait must survive the first cancel: session-b
  // still depends on it.
  const auth = await app.request('POST', `/servers/${id}/auth`);
  assert.equal(auth.status, 200, JSON.stringify(auth));
  const port = new URL(redirectOf(auth.authorizeUrl)).port;

  const canceled = await app.request('POST', '/attention/cancel', { sessionId: 'session-a', serverId: id });
  assert.equal(canceled.canceled, 1);
  assert.equal(canceled.released, false, 'the pending flow stays for the session that still waits');
  await assert.rejects(first, /cancelled/);
  const remaining = (await app.request('GET', '/attention')).items;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].sessionId, 'session-b');
  assert.equal(remaining[0].pending, 1);

  const last = await app.request('POST', '/attention/cancel', { sessionId: 'session-b', serverId: id });
  assert.equal(last.canceled, 1);
  assert.equal(last.released, true, 'the last cancel releases the pending flow');
  await assert.rejects(second, /cancelled/);
  await waitFor(() => canBindPort(Number(port)), 'the callback listener is released');
  await waitFor(async () => (await app.request('GET', '/attention')).items.length === 0, 'the listing is empty');
});

it('answers no-ops and rejects a malformed cancel', async (t) => {
  const app = mount(t);
  assert.deepEqual(await app.request('GET', '/attention'), { status: 200, items: [] });
  assert.deepEqual(await app.request('POST', '/attention/cancel', { sessionId: 's', serverId: 'missing' }), { status: 200, canceled: 0, released: false });
  const malformed = await app.request('POST', '/attention/cancel', { sessionId: '' });
  assert.equal(malformed.status, 400);
  assert.match(malformed.error, /sessionId and serverId are required/);
});
