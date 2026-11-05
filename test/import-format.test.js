/**
 * The `mcpServers` document: envelope validation, per-entry normalization and
 * the plan a preview shows.
 *
 * Pure module, no profile paths and no I/O, so these tests run against plain
 * objects and pin the classification rules the dialog renders.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';

import {
  MAX_ENTRIES,
  normalizeEntry,
  parseDocument,
  planImport,
  transportOf,
} from '../lib/import/format.js';

const server = (overrides = {}) => ({
  type: 'http',
  url: 'https://mcp.example.com/mcp',
  authMode: 'oauth',
  ...overrides,
});

function plan(entries, snapshot = {}, options = {}) {
  const parsed = parseDocument({ mcpServers: entries });
  assert.equal(parsed.error, undefined, parsed.error);
  return planImport(parsed.entries, { scope: 'global', path: null, mode: 'import', current: new Map(), otherNames: new Map(), disabled: new Set(), ...snapshot }, options);
}

it('rejects a document without the mcpServers envelope', () => {
  assert.match(parseDocument({ type: 'http', url: 'https://x.test/' }).error, /mcpServers/);
  assert.match(parseDocument([{ name: 'x' }]).error, /JSON object/);
  assert.match(parseDocument('not json').error, /invalid JSON/);
  assert.equal(parseDocument({ mcpServers: {} }).entries.length, 0);
});

it('rejects names that collide after trimming', () => {
  const parsed = parseDocument({ mcpServers: { github: server(), ' github ': server() } });
  assert.match(parsed.error, /same server/);
  assert.equal(parsed.field, 'name');
});

it('rejects a batch above the entry limit', () => {
  const mcpServers = {};
  for (let index = 0; index <= MAX_ENTRIES; index += 1) mcpServers[`s${index}`] = server();
  assert.match(parseDocument({ mcpServers }).error, new RegExp(String(MAX_ENTRIES)));
});

it('accepts a raw JSON string and the same document as an object', () => {
  const document = { mcpServers: { github: server() } };
  assert.equal(parseDocument(JSON.stringify(document)).entries.length, 1);
  assert.equal(parseDocument(document).entries.length, 1);
});

it('infers stdio from a Claude-style entry and reads sse as http', () => {
  assert.equal(transportOf({ command: 'npx', args: ['-y', 'pkg'] }).type, 'stdio');
  assert.equal(transportOf({ command: 'npx', url: 'https://x.test/' }).type, 'http');
  assert.equal(transportOf({ type: 'sse', url: 'https://x.test/' }).type, 'http');
  const stdio = normalizeEntry('local', { command: 'npx', args: ['-y', 'pkg'] });
  assert.equal(stdio.entry.type, 'stdio');
  assert.deepEqual(stdio.entry.args, ['-y', 'pkg']);
  assert.deepEqual(stdio.notes, ['type-inferred-stdio']);
  const sse = normalizeEntry('remote', { type: 'sse', url: 'https://x.test/sse' });
  assert.equal(sse.entry.type, 'http');
  assert.deepEqual(sse.notes, ['sse-read-as-http']);
});

it('discards keys the schema does not define, including credentials', () => {
  const normalized = normalizeEntry('github', server({
    oauth: { tokens: { access_token: 'secret' }, clientId: 'abc' },
    tokens: { access_token: 'secret' },
    staticToken: 'secret',
    http_headers: { Authorization: 'Bearer secret' },
  }));
  assert.equal(normalized.error, undefined);
  assert.equal(normalized.entry.oauth, undefined);
  assert.equal(normalized.entry.tokens, undefined);
  assert.equal(normalized.entry.staticToken, undefined);
  assert.equal(normalized.entry.http_headers, undefined);
  assert.deepEqual(Object.keys(normalized.entry).sort(), ['authMode', 'headerEnv', 'headers', 'type', 'url']);
});

it('reports the offending field of an invalid entry', () => {
  assert.equal(normalizeEntry('bad', { type: 'http', url: 'ftp://x' }).error.field, 'url');
  assert.equal(normalizeEntry('bad', { type: 'stdio' }).error.field, 'command');
  assert.equal(normalizeEntry('bad name', server()).error.field, 'name');
  assert.equal(normalizeEntry('bad', 'nope').error.field, 'entry');
  assert.equal(normalizeEntry('bad', server({ clientSecretEnv: 'sk-not-an-env-name' })).error.field, 'clientSecretEnv');
});

it('classifies new, update, unchanged and conflict in one batch', () => {
  const current = new Map([
    ['github', { name: 'github', ...server({ url: 'https://api.github.com/mcp', authMode: 'static', tokenEnv: 'GH_TOKEN' }) }],
    ['figma', { name: 'figma', ...server({ url: 'https://mcp.figma.com/mcp' }) }],
  ]);
  const otherNames = new Map([['obsidian', { scope: 'workspace', path: '/tmp/ws', enabled: true }]]);
  const result = plan({
    github: server({ url: 'https://api.github.com/mcp', authMode: 'static', tokenEnv: 'GH_TOKEN' }),
    figma: server({ url: 'https://mcp.figma.com/mcp' }),
    unity: server({ url: 'http://localhost:8090/', authMode: 'none' }),
    linear: server({ url: 'https://mcp.linear.app/mcp' }),
    obsidian: server({ url: 'http://127.0.0.1:27123/' }),
  }, { current, otherNames });

  const byName = Object.fromEntries(result.entries.map((entry) => [entry.name, entry]));
  assert.equal(byName.github.action, 'unchanged');
  assert.equal(byName.figma.action, 'unchanged');
  assert.equal(byName.unity.action, 'new');
  assert.equal(byName.linear.action, 'new');
  assert.equal(byName.obsidian.action, 'conflict');
  assert.equal(byName.obsidian.conflict.scope, 'workspace');
  assert.equal(result.summary.new, 2);
  assert.equal(result.summary.unchanged, 2);
  assert.equal(result.summary.conflict, 1);
  assert.equal(result.blocked, 'conflict');
  assert.equal(result.applyCount, 2);
});

it('reports what an update changes', () => {
  const current = new Map([
    ['github', {
      name: 'github',
      ...server({ authMode: 'static', tokenEnv: 'GH_TOKEN' }),
      headers: { 'X-Trace': '1' },
    }],
  ]);
  const result = plan({ github: server({ authMode: 'none' }) }, { current });
  const entry = result.entries[0];
  assert.equal(entry.action, 'update');
  const fields = entry.changes.map((change) => change.field).sort();
  assert.deepEqual(fields, ['authMode', 'headers', 'tokenEnv']);
  const authMode = entry.changes.find((change) => change.field === 'authMode');
  assert.equal(authMode.from, 'static');
  assert.equal(authMode.to, 'none');
  const tokenEnv = entry.changes.find((change) => change.field === 'tokenEnv');
  assert.equal(tokenEnv.from, 'GH_TOKEN');
  assert.equal(tokenEnv.to, null);
});

it('blocks on an invalid entry and reports every one of them', () => {
  const result = plan({
    good: server(),
    badUrl: { type: 'http', url: 'nope' },
    badClient: server({ clientSecretEnv: 'sk-secret' }),
  });
  assert.equal(result.blocked, 'invalid');
  assert.equal(result.summary.invalid, 2);
  const invalid = result.entries.filter((entry) => entry.action === 'invalid');
  assert.deepEqual(invalid.map((entry) => entry.error.field).sort(), ['clientSecretEnv', 'url']);
  assert.equal(result.applyCount, 1);
});

it('resolves a conflict as keep or replace', () => {
  const otherNames = new Map([['obsidian', { scope: 'global', path: null, enabled: true }]]);
  const entries = { obsidian: server({ url: 'http://127.0.0.1:27123/' }) };
  const kept = plan(entries, { scope: 'workspace', path: '/tmp/ws', otherNames }, { resolutions: { obsidian: 'keep' } });
  assert.equal(kept.entries[0].resolution, 'keep');
  assert.equal(kept.blocked, null);
  assert.equal(kept.applyCount, 0);
  const replaced = plan(entries, { scope: 'workspace', path: '/tmp/ws', otherNames }, { resolutions: { obsidian: 'replace' } });
  assert.equal(replaced.entries[0].resolution, 'replace');
  assert.equal(replaced.applyCount, 1);
});

it('adds deletes only in edit mode, for entries absent from the document', () => {
  const current = new Map([
    ['keep', { name: 'keep', ...server() }],
    ['drop', { name: 'drop', ...server({ url: 'https://drop.test/mcp' }) }],
  ]);
  const imported = plan({ keep: server() }, { current, mode: 'import' });
  assert.equal(imported.entries.some((entry) => entry.action === 'delete'), false);
  const edited = plan({ keep: server() }, { current, mode: 'edit' });
  const deleted = edited.entries.find((entry) => entry.action === 'delete');
  assert.equal(deleted.name, 'drop');
  assert.equal(edited.summary.delete, 1);
  assert.equal(edited.applyCount, 1);
});

it('deletes the whole scope when the edit document is empty', () => {
  const current = new Map([
    ['a', { name: 'a', ...server() }],
    ['b', { name: 'b', ...server({ url: 'https://b.test/mcp' }) }],
  ]);
  const result = plan({}, { current, mode: 'edit' });
  assert.equal(result.summary.delete, 2);
  assert.equal(result.applyCount, 2);
});

it('marks an entry that stays disabled', () => {
  const result = plan({ github: server() }, { disabled: new Set(['github']) });
  assert.equal(result.entries[0].staysDisabled, true);
});

it('keeps a stored session only when the identity and issuer match', () => {
  const current = new Map([
    ['github', {
      name: 'github',
      ...server(),
      clientId: 'abc',
      oauth: { authorizationServer: 'https://auth.github.com', tokens: { access_token: 'x' } },
    }],
  ]);
  const kept = plan({ github: server({ url: 'https://mcp.example.com/other' }) }, { current });
  assert.equal(kept.entries[0].keepsSession, true);
  const dropped = plan({ github: server({ clientId: 'def' }) }, { current });
  assert.equal(dropped.entries[0].keepsSession, false);
});

it('rejects every entry that is not the locked server', () => {
  const parsed = parseDocument({ mcpServers: { github: server() } }, { lockedName: 'github' });
  assert.equal(parsed.error, undefined);
  const result = planImport(parsed.entries, { scope: 'global', path: null, mode: 'edit', current: new Map() }, { lockedName: 'github' });
  assert.equal(result.entries[0].action, 'new');
  const other = planImport([{ name: 'unity', raw: server() }], { scope: 'global', path: null, mode: 'edit', current: new Map() }, { lockedName: 'github' });
  assert.equal(other.entries[0].action, 'invalid');
  assert.match(other.entries[0].error.message, /locked to "github"/);
  assert.match(parseDocument({ mcpServers: { unity: server() } }, { lockedName: 'github' }).error, /must describe the server "github"/);
});
