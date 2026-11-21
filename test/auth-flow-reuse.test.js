/**
 * A wait surface must join a live authorization instead of replacing it.
 *
 * Several surfaces can ask for the same server at once (Settings, the conversation
 * banner, the frame-wide alert). A second flow would invalidate the first one
 * pending state, so the reuse request returns the URL already in flight.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, it } from 'node:test';

const scratch = mkdtempSync(join(tmpdir(), 'dsh-mm-reuse-'));
process.env.HOME = scratch;
process.env.USERPROFILE = scratch;
process.env.DSH_HOME = join(scratch, '.dsh');
mkdirSync(process.env.DSH_HOME, { recursive: true });
const statePath = join(process.env.DSH_HOME, 'mcp-manager.json');

const mod = await import('../lib/index.js');
const { mountPlugin } = await import('./helpers/plugin-harness.js');
const { startAuthorizationStub } = await import('./helpers/oauth-harness.js');

after(() => rmSync(scratch, { recursive: true, force: true }));
beforeEach(() => writeFileSync(statePath, JSON.stringify({ servers: [] })));

it('returns the flow already in flight when reuse is requested', { timeout: 20000 }, async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const app = mountPlugin(mod, { config: {} });
  t.after(() => app.dispose());

  const created = await app.request('POST', '/servers', { name: 'database', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  assert.equal(created.status, 201, JSON.stringify(created));

  // A wait surface starts the flow.
  const first = await app.request('POST', `/servers/${created.server.id}/auth`, { reuse: true });
  assert.equal(first.status, 200, 'first: ' + JSON.stringify(first));
  assert.equal(first.status, 200, JSON.stringify(first));
  assert.ok(first.authorizeUrl, 'the first request returned an authorization URL');

  // A second surface asks to join the same flow.
  const second = await app.request('POST', `/servers/${created.server.id}/auth`, { reuse: true });
  assert.equal(second.status, 200, JSON.stringify(second));
  assert.equal(second.authorizeUrl, first.authorizeUrl, 'the second surface joins the live flow');
});

it('starts a fresh flow when reuse is not requested', { timeout: 20000 }, async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const app = mountPlugin(mod, { config: {} });
  t.after(() => app.dispose());

  const created = await app.request('POST', '/servers', { name: 'database', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  assert.equal(created.status, 201, JSON.stringify(created));

  const first = await app.request('POST', `/servers/${created.server.id}/auth`);
  const second = await app.request('POST', `/servers/${created.server.id}/auth`);
  assert.notEqual(second.authorizeUrl, first.authorizeUrl, 'an explicit caller keeps a new flow');
});
