/**
 * Dead MCP transport session repair.
 *
 * A server that forgot the session answers a client error naming it. The host
 * must rebuild the connection, replay the request once and keep the failure
 * away from the caller; only a second failure surfaces.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, it } from 'node:test';

const scratch = mkdtempSync(join(tmpdir(), 'dsh-mm-dead-session-'));
process.env.HOME = scratch;
process.env.USERPROFILE = scratch;
process.env.DSH_HOME = join(scratch, '.dsh');
mkdirSync(process.env.DSH_HOME, { recursive: true });
const statePath = join(process.env.DSH_HOME, 'mcp-manager.json');

const mod = await import('../lib/index.js');
const { mountPlugin } = await import('./helpers/plugin-harness.js');
const { deliverCallback, startAuthorizationStub } = await import('./helpers/oauth-harness.js');

after(() => { rmSync(scratch, { recursive: true, force: true }); });
beforeEach(() => writeFileSync(statePath, JSON.stringify({ servers: [] })));

function mount(t) {
  const app = mountPlugin(mod, {});
  t.after(() => app.dispose());
  return app;
}

async function connectServer(app, stub) {
  const created = await app.request('POST', '/servers', { name: 'database', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  assert.equal(created.status, 201, JSON.stringify(created));
  const auth = await app.request('POST', '/servers/' + created.server.id + '/auth');
  assert.equal(auth.status, 200, JSON.stringify(auth));
  assert.match((await deliverCallback(auth.authorizeUrl)).text, /Authorized/);
  return created.server.id;
}

it('repairs a forgotten session and returns the result without an error', { timeout: 15000 }, async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const app = mount(t);
  await connectServer(app, stub);

  // The server restarts and forgets every session it issued.
  stub.forgetSessions();

  const definition = app.tool('mcp__database__echo');
  const result = await definition.execute({ ping: 'survives' }, { agent: { id: 'session-a' } });

  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(stub.deadSessionBodies > 0, true, 'the first attempt really hit the dead session');
  assert.deepEqual(stub.toolCalls.at(-1), { name: 'echo', arguments: { ping: 'survives' } });
});

it('keeps the server connected and creates no authentication wait', { timeout: 15000 }, async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const app = mount(t);
  await connectServer(app, stub);
  stub.forgetSessions();

  const definition = app.tool('mcp__database__echo');
  await definition.execute({}, { agent: { id: 'session-a' } });

  const listed = await app.request('GET', '/servers');
  const row = listed.servers.find((entry) => entry.name === 'database');
  assert.equal(row.status, 'connected', JSON.stringify(row));
  const attention = await app.request('GET', '/attention');
  assert.deepEqual(attention.items, [], 'a repairable session is not a wait');
});

it('reflects the tool listing of the rebuilt session', { timeout: 15000 }, async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const app = mount(t);
  const id = await connectServer(app, stub);
  stub.forgetSessions();

  const definition = app.tool('mcp__database__echo');
  await definition.execute({}, { agent: { id: 'session-a' } });

  const inventory = await app.request('GET', '/servers/' + id + '/tools');
  assert.equal(inventory.status, 200, JSON.stringify(inventory));
  assert.deepEqual(inventory.tools, ['echo']);
  assert.notEqual(inventory.stale, true, 'the inventory is live again');
});

it('does not reconnect when nothing named a session', { timeout: 15000 }, async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const app = mount(t);
  await connectServer(app, stub);

  const definition = app.tool('mcp__database__echo');
  await definition.execute({}, { agent: { id: 'session-a' } });

  assert.equal(stub.deadSessionBodies, 0);
});
