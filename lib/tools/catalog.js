/**
 * The tool catalog retained for one MCP server: the raw `tools/list` entries of
 * its last successful listing, normalized and bounded so the sidecar file cannot
 * grow without limit.
 *
 * Pure: no file system, no plugin state, no clock. The store owns persistence and
 * the host owns when a catalog is written or discarded.
 */

/** Maximum retained entries per server. */
export const MAX_CATALOG_ENTRIES = 200;

/** Maximum serialized catalog per server, in bytes. */
export const MAX_CATALOG_BYTES = 128 * 1024;

/** Description length kept per entry; the definition truncates at the same bound. */
export const MAX_DESCRIPTION_CHARS = 2000;

/**
 * Serialized size of a catalog, measured the way it is persisted.
 * @param tools - catalog entries.
 * @returns the UTF-8 byte length of the JSON form.
 */
export function catalogSize(tools) {
  return Buffer.byteLength(JSON.stringify(Array.isArray(tools) ? tools : []), 'utf8');
}

/**
 * Normalize one listing into the entries worth retaining.
 *
 * The name is the identity: an entry without a usable name is dropped, a repeated
 * name keeps its first occurrence, and the result is ordered by name so a
 * persisted catalog is stable regardless of the order the server listed it in.
 * Entries are then bounded by count and by serialized size; the overflow is
 * dropped from the end of the ordered list, which keeps the retained subset
 * deterministic.
 *
 * @param tools - raw `tools/list` entries.
 * @param options.maxEntries - retained entry limit (default MAX_CATALOG_ENTRIES).
 * @param options.maxBytes - serialized byte limit (default MAX_CATALOG_BYTES).
 * @returns the retained entries and how many were dropped.
 */
export function buildCatalog(tools, { maxEntries = MAX_CATALOG_ENTRIES, maxBytes = MAX_CATALOG_BYTES } = {}) {
  const byName = new Map();
  for (const tool of Array.isArray(tools) ? tools : []) {
    if (!tool || typeof tool !== 'object') continue;
    // The raw name is the identity and the source of the public name: it is used
    // verbatim, never trimmed into a name the server never listed.
    const name = typeof tool.name === 'string' ? tool.name : '';
    if (!name.trim() || byName.has(name)) continue;
    const entry = { name, description: typeof tool.description === 'string' ? tool.description.slice(0, MAX_DESCRIPTION_CHARS) : '' };
    if (tool.inputSchema && typeof tool.inputSchema === 'object' && !Array.isArray(tool.inputSchema)) entry.inputSchema = tool.inputSchema;
    byName.set(name, entry);
  }
  const ordered = [...byName.values()].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const kept = [];
  let dropped = 0;
  for (const entry of ordered) {
    if (kept.length >= maxEntries || catalogSize([...kept, entry]) > maxBytes) { dropped += 1; continue; }
    kept.push(entry);
  }
  return { tools: kept, dropped };
}

/**
 * Raw names of a catalog, ordered and deduplicated.
 * @param tools - catalog entries.
 * @returns the names a card or an endpoint can present.
 */
export function catalogNames(tools) {
  if (!Array.isArray(tools)) return [];
  const names = tools.map((tool) => (typeof tool?.name === 'string' ? tool.name : '')).filter(Boolean);
  return [...new Set(names)].sort();
}
