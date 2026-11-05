/**
 * Applying a plan through injected ports: the order of the writes, the two
 * tiers, deletes, and the session a move carries across scopes.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';

import { applyPlan } from '../lib/import/apply.js';

const http = (overrides = {}) => ({ type: 'http', url: 'https://mcp.example.com/mcp', authMode: 'oauth', ...overrides });

function harness({ servers = [], raw = { mcpServers: {} }, tokens = {} } = {}) {
  const log = [];
  const workspace = JSON.parse(JSON.stringify(raw));
  const ports = {
    log,
    workspace: () => workspace,
    state: null,
    readWorkspaceRaw: () => workspace,
    writeWorkspaceRaw: (_path, value) => { log.push('write'); Object.assign(workspace, value); },
    saveState: async () => { log.push('save'); },
    findGlobal: (name) => state.servers.find((row) => row.name === name) ?? null,
    addGlobal: (row) => { state.servers.push(row); },
    removeGlobal: (row) => { state.servers = state.servers.filter((candidate) => candidate !== row); },
    workspaceToken: (_path, name) => tokens[name],
    setWorkspaceToken: (_path, name, oauth) => { if (oauth) tokens[name] = oauth; else delete tokens[name]; },
    connect: async (row) => { log.push(`connect:${row.name}`); },
    disconnect: (row) => { log.push(`disconnect:${row.name}`); },
    cancelSessions: async (id) => { log.push(`cancel:${id}`); },
    clearAttempts: () => {},
    rescan: async () => { log.push('rescan'); },
    isGlobalName: (name) => state.servers.some((row) => row.name === name),
    newId: () => 'new-id',
  };
  const state = { servers };
  ports.state = state;
  return ports;
}

const planOf = (overrides) => ({
  scope: 'global',
  path: null,
  mode: 'import',
  entries: [],
  blocked: null,
  applyCount: 0,
  ...overrides,
});

const entry = (overrides) => ({
  changes: [], keepsSession: false, staysDisabled: false, conflict: null, resolution: null, error: null, notes: [],
  ...overrides,
});

it('creates a profile server, persists first and then connects it', async () => {
  const ports = harness();
  const seen = [];
  const originalSave = ports.saveState;
  ports.saveState = async () => { seen.push(ports.log.includes('write') ? 'file-before-state' : 'state-first'); await originalSave(); };
  const result = await applyPlan(planOf({
    entries: [entry({ name: 'github', action: 'new', entry: http() })],
    applyCount: 1,
  }), ports);
  assert.deepEqual(ports.state.servers.map((row) => row.name), ['github']);
  assert.equal(ports.state.servers[0].id, 'new-id');
  assert.deepEqual(seen, ['state-first']);
  assert.deepEqual(ports.log, ['save', 'connect:github']);
  assert.deepEqual(result.applied, ['github']);
});

it('writes a workspace entry and leaves the rest of the file alone', async () => {
  const ports = harness({ raw: { mcpServers: { keep: http() }, customKey: { a: 1 }, disabled: ['keep'] } });
  await applyPlan(planOf({
    scope: 'workspace',
    path: '/ws',
    entries: [entry({ name: 'added', action: 'new', entry: http({ url: 'https://added.test/mcp', authMode: 'none' }) })],
    applyCount: 1,
  }), ports);
  const raw = ports.workspace();
  assert.deepEqual(Object.keys(raw.mcpServers).sort(), ['added', 'keep']);
  assert.deepEqual(raw.customKey, { a: 1 });
  assert.deepEqual(raw.disabled, ['keep']);
  assert.ok(ports.log.includes('rescan'));
});

it('deletes a workspace entry and prunes its off-list rows', async () => {
  const ports = harness({ raw: { mcpServers: { local: http() }, disabled: ['local', 'other'], exclude: ['local'] } });
  await applyPlan(planOf({
    scope: 'workspace',
    path: '/ws',
    mode: 'edit',
    entries: [entry({ name: 'local', action: 'delete' })],
    applyCount: 1,
  }), ports);
  const raw = ports.workspace();
  assert.deepEqual(raw.mcpServers, {});
  assert.deepEqual(raw.disabled, ['other']);
  assert.equal(raw.exclude, undefined);
});

it('deletes a profile server, cancelling its sessions and dropping the row', async () => {
  const row = { id: 'g1', name: 'drop', ...http() };
  const ports = harness({ servers: [row] });
  await applyPlan(planOf({
    mode: 'edit',
    entries: [entry({ name: 'drop', action: 'delete' })],
    applyCount: 1,
  }), ports);
  assert.deepEqual(ports.state.servers, []);
  assert.ok(ports.log.includes('cancel:g1'));
  assert.ok(ports.log.includes('disconnect:drop'));
});

it('moves a matching session from the profile scope into the workspace on replace', async () => {
  const oauth = { authorizationServer: 'https://auth.example.com', tokens: { access_token: 'x' } };
  const row = { id: 'g1', name: 'shared', ...http(), oauth };
  const ports = harness({ servers: [row] });
  const tokens = {};
  ports.workspaceToken = () => tokens.shared;
  ports.setWorkspaceToken = (_path, name, value) => { if (value) tokens[name] = value; else delete tokens[name]; };
  await applyPlan(planOf({
    scope: 'workspace',
    path: '/ws',
    entries: [entry({
      name: 'shared',
      action: 'conflict',
      conflict: { scope: 'global', path: null, enabled: true },
      resolution: 'replace',
      entry: http(),
    })],
    applyCount: 1,
  }), ports);
  assert.deepEqual(ports.state.servers, [], 'the profile row is gone');
  assert.deepEqual(ports.workspace().mcpServers.shared.url, 'https://mcp.example.com/mcp');
  assert.ok(tokens.shared, 'the session followed the server');
  assert.deepEqual(tokens.shared.tokens, oauth.tokens);
});

it('does not carry a session whose identity changed on replace', async () => {
  const row = { id: 'g1', name: 'shared', ...http({ clientId: 'abc' }), oauth: { tokens: { access_token: 'x' } } };
  const ports = harness({ servers: [row] });
  const tokens = {};
  ports.setWorkspaceToken = (_path, name, value) => { if (value) tokens[name] = value; else delete tokens[name]; };
  await applyPlan(planOf({
    scope: 'workspace',
    path: '/ws',
    entries: [entry({
      name: 'shared',
      action: 'conflict',
      conflict: { scope: 'global', path: null, enabled: true },
      resolution: 'replace',
      entry: http({ clientId: 'def' }),
    })],
    applyCount: 1,
  }), ports);
  assert.equal(tokens.shared, undefined);
});

it('refuses a blocked plan without touching anything', async () => {
  const ports = harness();
  await assert.rejects(() => applyPlan(planOf({ blocked: 'invalid', entries: [] }), ports), /invalid/);
  assert.deepEqual(ports.log, []);
});

it('reconnects a changed profile server and keeps its session', async () => {
  const oauth = { authorizationServer: 'https://auth.example.com', tokens: { access_token: 'x' } };
  const row = { id: 'g1', name: 'github', ...http(), oauth };
  const ports = harness({ servers: [row] });
  await applyPlan(planOf({
    entries: [entry({ name: 'github', action: 'update', keepsSession: true, entry: http({ url: 'https://mcp.example.com/v2' }) })],
    applyCount: 1,
  }), ports);
  const saved = ports.state.servers[0];
  assert.equal(saved.url, 'https://mcp.example.com/v2');
  assert.deepEqual(saved.oauth, oauth);
  assert.deepEqual(ports.log, ['disconnect:github', 'save', 'connect:github']);
});

it('keeps the replaced owner when the replacement cannot be written', async () => {
  // Create-before-evict: a failing target write must not delete the server it
  // was going to replace. The batch fails; the owner is still there.
  const row = { id: 'g1', name: 'shared', ...http() };
  const ports = harness({ servers: [row] });
  let writes = 0;
  ports.writeWorkspaceRaw = () => { writes += 1; throw new Error('disk full'); };
  const plan = planOf({
    scope: 'workspace',
    path: '/ws',
    entries: [entry({
      name: 'shared',
      action: 'conflict',
      conflict: { scope: 'global', path: null, enabled: true },
      resolution: 'replace',
      entry: http(),
    })],
    applyCount: 1,
  });
  await assert.rejects(() => applyPlan(plan, ports), /disk full/);
  assert.equal(writes, 1);
  assert.deepEqual(ports.state.servers.map((candidate) => candidate.name), ['shared']);
});
