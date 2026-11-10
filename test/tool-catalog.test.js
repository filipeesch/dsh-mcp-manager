/**
 * The retained tool catalog: normalization and its bounds.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { buildCatalog, catalogNames, catalogSize, MAX_CATALOG_ENTRIES } from '../lib/tools/catalog.js';

const entry = (name, extra = {}) => ({ name, description: `does ${name}`, inputSchema: { type: 'object' }, ...extra });

it('normalizes a listing into ordered, deduplicated entries', () => {
  const { tools, dropped } = buildCatalog([entry('zebra'), entry('alpha'), entry('alpha'), { description: 'nameless' }, null, entry('middle')]);
  assert.deepEqual(tools.map((tool) => tool.name), ['alpha', 'middle', 'zebra']);
  assert.equal(dropped, 0);
});

it('keeps only the fields a definition needs', () => {
  const { tools } = buildCatalog([{ name: 'read', description: 'reads', inputSchema: { type: 'object' }, extra: 'dropped', annotations: { title: 'x' } }]);
  assert.deepEqual(Object.keys(tools[0]).sort(), ['description', 'inputSchema', 'name']);
});

it('drops an input schema that is not an object', () => {
  const { tools } = buildCatalog([{ name: 'read', inputSchema: 'nope' }]);
  assert.equal(tools[0].inputSchema, undefined);
  assert.equal(tools[0].description, '');
});

it('truncates an oversized description', () => {
  const { tools } = buildCatalog([entry('read', { description: 'x'.repeat(5000) })]);
  assert.equal(tools[0].description.length, 2000);
});

it('bounds the entry count from the end of the ordered list', () => {
  const { tools, dropped } = buildCatalog([entry('c'), entry('a'), entry('b')], { maxEntries: 2 });
  assert.deepEqual(tools.map((tool) => tool.name), ['a', 'b']);
  assert.equal(dropped, 1);
});

it('bounds the serialized size', () => {
  const { tools, dropped } = buildCatalog([entry('a'), entry('b'), entry('c')], { maxBytes: catalogSize([entry('a')]) + 10 });
  assert.ok(tools.length < 3);
  assert.ok(dropped >= 1);
});

it('keeps the default bound finite', () => {
  const many = Array.from({ length: MAX_CATALOG_ENTRIES + 5 }, (_, index) => entry(`tool-${String(index).padStart(3, '0')}`));
  const { tools } = buildCatalog(many);
  assert.equal(tools.length, MAX_CATALOG_ENTRIES);
});

it('presents names ordered and deduplicated', () => {
  assert.deepEqual(catalogNames([{ name: 'b' }, { name: 'a' }, { name: 'a' }, {}]), ['a', 'b']);
  assert.deepEqual(catalogNames(undefined), []);
});
