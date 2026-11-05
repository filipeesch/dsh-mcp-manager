/**
 * The pure configuration helpers every write path shares: one builder, one
 * identity predicate, and the row patch that preserves what the plugin does
 * not know.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';

import {
  buildServerEntry,
  buildWorkspaceEntry,
  keepsStoredSession,
  normalizeWorkspaceServer,
  patchServerRow,
  sameAuthIdentity,
  sameServerConfig,
} from '../lib/servers/config.js';

const http = (overrides = {}) => ({ type: 'http', url: 'https://mcp.example.com/mcp', authMode: 'oauth', ...overrides });

function fieldOf(input, current = null) {
  try {
    buildServerEntry(input, current);
  } catch (error) {
    return error.field;
  }
  return null;
}

it('names the offending field for every invalid input', () => {
  assert.equal(fieldOf({ name: 'bad name', ...http() }), 'name');
  assert.equal(fieldOf({ name: 'ok', type: 'http', url: 'ftp://x' }), 'url');
  assert.equal(fieldOf({ name: 'ok', type: 'stdio' }), 'command');
  assert.equal(fieldOf({ name: 'ok', ...http({ clientId: 'x'.repeat(513) }) }), 'clientId');
  assert.equal(fieldOf({ name: 'ok', ...http({ clientSecretEnv: 'sk-live-secret' }) }), 'clientSecretEnv');
  assert.equal(fieldOf({ name: 'ok', ...http({ clientName: 'a'.repeat(129) }) }), 'clientName');
  assert.equal(fieldOf({ name: 'ok', ...http({ scope: 's'.repeat(513) }) }), 'scope');
  assert.equal(fieldOf({ name: 'ok', ...http({ redirectUrl: 'https://evil.example.com/callback' }) }), 'redirectUrl');
});

it('inherits an omitted or empty tokenEnv like the profile editor', () => {
  const current = { name: 'unity', ...http({ authMode: 'static', tokenEnv: 'UNITY_TOKEN' }) };
  assert.equal(buildServerEntry({ ...http({ authMode: 'static' }), name: 'unity' }, current).entry.tokenEnv, 'UNITY_TOKEN');
  assert.equal(buildServerEntry({ ...http({ authMode: 'static', tokenEnv: '' }), name: 'unity' }, current).entry.tokenEnv, 'UNITY_TOKEN');
  assert.equal(buildServerEntry({ ...http({ authMode: 'static', tokenEnv: 'OTHER' }), name: 'unity' }, current).entry.tokenEnv, 'OTHER');
});

it('inherits omitted OAuth credentials and clears an explicit empty value', () => {
  const current = { name: 'github', ...http({ clientId: 'abc', clientName: 'my-client', scope: 'repo' }) };
  const inherited = buildServerEntry({ name: 'github', url: 'https://api.github.com/mcp', authMode: 'oauth' }, current).entry;
  assert.equal(inherited.clientId, 'abc');
  assert.equal(inherited.clientName, 'my-client');
  assert.equal(inherited.scope, 'repo');
  const cleared = buildServerEntry({ name: 'github', url: 'https://api.github.com/mcp', authMode: 'oauth', clientId: '' }, current).entry;
  assert.equal(cleared.clientId, undefined);
  assert.equal(cleared.clientName, 'my-client');
});

it('treats the entry as a declaration for the structural fields', () => {
  const current = { name: 'github', ...http({ headers: { 'X-Old': '1' }, tokenEnv: 'OLD' }) };
  const { entry } = buildServerEntry({ name: 'github', url: 'https://api.github.com/mcp', authMode: 'oauth' }, current);
  assert.deepEqual(entry.headers, {});
  assert.equal(entry.headerEnv === undefined, false);
  assert.equal(entry.tokenEnv, undefined);
});

it('normalizes a workspace declaration and keeps the OAuth fields it carries', () => {
  const server = normalizeWorkspaceServer('local', { type: 'stdio', command: 'npx', args: '-y pkg', cwd: '' }, '/work/ws');
  assert.equal(server.type, 'stdio');
  assert.deepEqual(server.args, ['-y', 'pkg']);
  assert.equal(server.cwd, '/work/ws');
  assert.ok(server.id.startsWith('ws-'));
  const oauth = normalizeWorkspaceServer('github', { type: 'http', url: 'https://api.github.com/mcp', clientId: 'abc' }, '/work/ws');
  assert.equal(oauth.clientId, 'abc');
  assert.equal(oauth.authMode, 'oauth');
  assert.equal(normalizeWorkspaceServer('bad', { type: 'http', url: 'nope' }, '/work/ws'), null);
  assert.equal(normalizeWorkspaceServer('bad name', { type: 'http', url: 'https://x.test/' }, '/work/ws'), null);
  // A hand-edited invalid optional field must not drop the server.
  const lenient = normalizeWorkspaceServer('github', { type: 'http', url: 'https://api.github.com/mcp', clientSecretEnv: 'sk-secret' }, '/work/ws');
  assert.equal(lenient.clientSecretEnv, undefined);
  assert.equal(lenient.url, 'https://api.github.com/mcp');
});

it('returns the offending field from the workspace builder', () => {
  assert.equal(buildWorkspaceEntry({ name: 'ok', type: 'http', url: 'nope' }).field, 'url');
  assert.equal(buildWorkspaceEntry({ name: '', ...http() }).field, 'name');
  assert.equal(buildWorkspaceEntry({ name: 'ok', ...http() }).error, undefined);
});

it('patches a stored row and preserves the keys it does not know', () => {
  const row = {
    id: 'abc',
    name: 'github',
    enabled: false,
    ...http({ tokenEnv: 'OLD', headers: { 'X-Old': '1' } }),
    staticToken: 'legacy-plaintext',
    customUnknown: { keep: true },
  };
  patchServerRow(row, { type: 'http', url: 'https://api.github.com/mcp', authMode: 'none', headers: {}, headerEnv: {} });
  assert.equal(row.id, 'abc');
  assert.equal(row.name, 'github');
  assert.equal(row.enabled, false);
  assert.deepEqual(row.customUnknown, { keep: true });
  assert.equal(row.tokenEnv, undefined);
  assert.equal(row.staticToken, undefined);
  assert.deepEqual(row.headers, {});
});

it('keeps a stored session only while the client identity and issuer hold', () => {
  const oauth = { authorizationServer: 'https://auth.github.com', tokens: { access_token: 'x' } };
  // A dynamic registration: the client name comes from the server name.
  const dynamic = { name: 'github', ...http({ url: 'https://api.github.com/mcp' }), oauth };
  assert.equal(keepsStoredSession(dynamic, { ...http({ url: 'https://api.github.com/other' }) }, 'github'), true);
  assert.equal(keepsStoredSession(dynamic, { ...http({ url: 'https://other.example.com/mcp' }) }, 'github'), false);
  assert.equal(keepsStoredSession(dynamic, { ...http({ url: 'https://api.github.com/mcp' }) }, 'renamed'), false);
  assert.equal(keepsStoredSession(dynamic, { ...http({ url: 'https://api.github.com/mcp', clientName: 'custom' }) }, 'github'), false);
  // A manual client id is the identity: it never registers under the derived name.
  const manual = { ...dynamic, clientId: 'abc' };
  assert.equal(keepsStoredSession(manual, { ...http({ url: 'https://api.github.com/other', clientId: 'abc' }) }, 'renamed'), true);
  assert.equal(keepsStoredSession(manual, { ...http({ url: 'https://api.github.com/mcp', clientId: 'def' }) }, 'github'), false);
  assert.equal(sameAuthIdentity({ ...manual, name: 'a' }, { ...manual, name: 'b' }), true);
});

it('compares two server configurations field by field', () => {
  const base = { name: 'a', ...http() };
  assert.equal(sameServerConfig(base, { ...base }), true);
  assert.equal(sameServerConfig(base, { ...base, headers: { 'X': '1' } }), false);
  assert.equal(sameServerConfig({ ...base, timeout: '600000' }, { ...base, timeout: 600000 }), true);
});
