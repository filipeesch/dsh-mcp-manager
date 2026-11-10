/**
 * The plugin's interface has one language.
 *
 * The client carries a single English string table and never consults the
 * application's language setting; the shipped documentation is English-only.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { it } from 'node:test';
import { clientSource, mountClient } from './helpers/client-harness.js';

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

it('carries no second interface language', () => {
  assert.doesNotMatch(clientSource, CJK, 'no Chinese, Japanese or Korean string may remain');
  assert.doesNotMatch(clientSource, /ctx\.locale|locale:\s*"mcp"/, 'the client must not use the host locale service');
});

it('registers only the slots it renders', () => {
  const app = mountClient(async () => ({ ok: true, status: 200, json: async () => ({ tools: [] }) }));
  assert.deepEqual([...app.inject], ['slots']);
});

it('resolves every string from the English table', () => {
  const app = mountClient(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  assert.equal(app.t('sectionLabel'), 'MCP');
  assert.equal(app.t('toolCount', { count: 3 }), 'Tools: 3');
  assert.equal(app.t('toolsStale'), 'Cached from the last successful listing — authenticate to refresh');
  assert.equal(app.t('missingKey'), 'missingKey');
});

it('ships one English README', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.files.includes('README.md'));
  assert.ok(!pkg.files.some((entry) => /zh/i.test(entry)), 'no localized README may be published');
  assert.doesNotMatch(readFileSync(new URL('../README.md', import.meta.url), 'utf8'), /README\.zh-CN/);
});

it('publishes every source file the entry point imports', () => {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const patterns = pkg.files;
  const covered = (file) => patterns.some((pattern) => {
    if (pattern === file) return true;
    const star = pattern.indexOf('*');
    if (star < 0) return false;
    return file.startsWith(pattern.slice(0, star)) && file.endsWith(pattern.slice(star + 1));
  });
  const walk = (dir) => readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) return walk(`${path}/`);
    return entry.name.endsWith('.js') ? [path] : [];
  });
  const sources = walk('lib/');
  assert.ok(sources.length > 5, 'the walk must see the plugin sources');
  const missing = sources.filter((file) => !covered(file));
  assert.deepEqual(missing, [], 'every lib/**/*.js must be covered by package.json "files"');
});
