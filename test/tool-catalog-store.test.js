/**
 * The catalog sidecar: atomic persistence of one server's retained listing.
 *
 * The file is disposable and non-sensitive, so the tests care about three things:
 * a corrupt file never throws, two keys survive each other's writes, and no
 * credential from the state file can reach the catalog.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, it } from 'node:test';
import { createCatalogStore } from '../lib/tools/catalog-store.js';

const scratch = mkdtempSync(join(tmpdir(), 'dsh-mm-catalog-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

function storeFor(name, options = {}) {
  const warnings = [];
  const filePath = join(scratch, name, 'mcp-manager-tools.json');
  const store = createCatalogStore({ filePath, logger: { warn: (line) => warnings.push(line) }, now: () => 1234, ...options });
  return { store, filePath, warnings };
}

it('round-trips one catalog', async () => {
  const { store, filePath } = storeFor('round-trip');
  assert.equal(store.catalogOf('id:a'), null);
  assert.equal(await store.save('id:a', { name: 'alpha', tools: [{ name: 'read', description: 'reads' }] }), true);
  assert.deepEqual(store.catalogOf('id:a'), { name: 'alpha', listedAt: 1234, tools: [{ name: 'read', description: 'reads' }] });
  const document = JSON.parse(readFileSync(filePath, 'utf8'));
  assert.equal(document.version, 1);
});

it('keeps two keys when each is written separately', async () => {
  const { store } = storeFor('two-keys');
  await store.save('id:a', { name: 'alpha', tools: [] });
  await store.save('id:b', { name: 'beta', tools: [{ name: 'read' }] });
  assert.equal(store.catalogOf('id:a').name, 'alpha');
  assert.equal(store.catalogOf('id:b').name, 'beta');
});

it('replaces one key without touching the other', async () => {
  const { store } = storeFor('replace');
  await store.save('id:a', { name: 'alpha', tools: [{ name: 'one' }] });
  await store.save('id:b', { name: 'beta', tools: [{ name: 'two' }] });
  await store.save('id:a', { name: 'alpha', tools: [{ name: 'three' }] });
  assert.deepEqual(store.catalogOf('id:a').tools.map((tool) => tool.name), ['three']);
  assert.deepEqual(store.catalogOf('id:b').tools.map((tool) => tool.name), ['two']);
});

it('reads a corrupt file as empty and warns once', async () => {
  const { store, filePath, warnings } = storeFor('corrupt');
  await store.save('id:a', { name: 'alpha', tools: [] });
  writeFileSync(filePath, '{not json');
  assert.equal(store.catalogOf('id:a'), null);
  assert.equal(store.catalogOf('id:a'), null);
  assert.equal(warnings.filter((line) => line.includes('unreadable tool catalog')).length, 1);
  assert.equal(await store.save('id:a', { name: 'alpha', tools: [{ name: 'read' }] }), true);
  assert.equal(store.catalogOf('id:a').tools.length, 1);
});

it('discards one catalog', async () => {
  const { store } = storeFor('discard');
  await store.save('id:a', { name: 'alpha', tools: [{ name: 'read' }] });
  assert.equal(await store.remove('id:a'), true);
  assert.equal(store.catalogOf('id:a'), null);
  assert.equal(await store.remove('id:a'), true);
});

it('reports a locked file instead of throwing', async () => {
  const { store, filePath } = storeFor('locked', { lockWaitMs: 30, lockStepMs: 5 });
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(`${filePath}.lock`, 'someone-else');
  assert.equal(await store.save('id:a', { name: 'alpha', tools: [] }), false);
});

it('reads a path that cannot be a file as empty and reports it once', async () => {
  const warnings = [];
  const parent = join(scratch, 'not-a-dir');
  mkdirSync(parent, { recursive: true });
  writeFileSync(join(parent, 'blocked-file'), 'a file where a directory is expected');
  const filePath = join(parent, 'blocked-file', 'mcp-manager-tools.json');
  const store = createCatalogStore({ filePath, logger: { warn: (line) => warnings.push(line) } });
  assert.equal(store.catalogOf('id:a'), null);
  assert.equal(store.catalogOf('id:a'), null);
  assert.equal(warnings.filter((line) => line.includes('unreadable tool catalog')).length, 1);
});

it('reports a write that cannot create its directory instead of rejecting', async () => {
  const warnings = [];
  const blocked = join(scratch, 'write-blocked');
  writeFileSync(blocked, 'not a directory');
  const store = createCatalogStore({
    filePath: join(blocked, 'mcp-manager-tools.json'),
    logger: { warn: (line) => warnings.push(line) },
    lockWaitMs: 20,
    lockStepMs: 5,
  });
  assert.equal(await store.save('id:a', { name: 'alpha', tools: [] }), false);
  assert.equal(await store.remove('id:a'), false);
  assert.ok(warnings.length >= 1);
});

it('keeps both entries when two writers save at the same time', async () => {
  const filePath = join(scratch, 'concurrent', 'mcp-manager-tools.json');
  const one = createCatalogStore({ filePath, logger: { warn() {} } });
  const two = createCatalogStore({ filePath, logger: { warn() {} } });
  await Promise.all([
    one.save('id:a', { name: 'alpha', tools: [{ name: 'a-tool' }] }),
    two.save('id:b', { name: 'beta', tools: [{ name: 'b-tool' }] }),
  ]);
  assert.deepEqual(one.catalogOf('id:a')?.tools.map((tool) => tool.name), ['a-tool']);
  assert.deepEqual(two.catalogOf('id:b')?.tools.map((tool) => tool.name), ['b-tool']);
  assert.equal(existsSync(`${filePath}.lock`), false, 'the lock is released after both writes');
});

it('reclaims an abandoned lock and respects a live one', async () => {
  const { store, filePath } = storeFor('stale-lock', { lockWaitMs: 40, lockStepMs: 5 });
  mkdirSync(dirname(filePath), { recursive: true });
  // A crashed writer left its lock behind: older than the reclaim threshold.
  writeFileSync(`${filePath}.lock`, 'dead-owner');
  const old = new Date(Date.now() - 60_000);
  utimesSync(`${filePath}.lock`, old, old);
  assert.equal(await store.save('id:a', { name: 'alpha', tools: [{ name: 'read' }] }), true);
  assert.equal(store.catalogOf('id:a')?.tools.length, 1);
  // A live writer owns the lock: the save is skipped, never forced through.
  writeFileSync(`${filePath}.lock`, 'live-owner');
  assert.equal(await store.save('id:b', { name: 'beta', tools: [] }), false);
});

it('never records a credential from the state file, and keeps server text verbatim', async () => {
  const { store, filePath } = storeFor('secrets');
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(join(dirname(filePath), 'mcp-manager.json'), JSON.stringify({ servers: [], access_token: 'state-token-value' }));
  // A description that looks like a credential is the server's own text: it is
  // stored as the server wrote it and never filtered.
  await store.save('id:a', { name: 'alpha', tools: [{ name: 'read', description: 'access_token=server-supplied text' }] });
  const text = readFileSync(filePath, 'utf8');
  assert.ok(!text.includes('state-token-value'), 'a state-file credential never reaches the catalog');
  assert.ok(text.includes('access_token=server-supplied text'), 'a server description is stored verbatim');
});
