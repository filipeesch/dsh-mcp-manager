import {
  buildServerEntry,
  isValidServerName,
  keepsStoredSession,
  sameServerConfig,
} from '../servers/config.js';

/**
 * The `mcpServers` document: parsing, per-entry normalization and the plan a
 * preview shows and an application executes.
 *
 * Everything here is pure. The caller supplies a snapshot of the target scope
 * and of the names occupied elsewhere, so the same code classifies a document
 * without touching the state file, a workspace file, or a connection.
 */

export const MAX_ENTRIES = 200;
export const MAX_BYTES = 1024 * 1024;
export const MODES = Object.freeze(['import', 'edit']);

/** Fields whose value change is reported for an entry. */
const CHANGE_FIELDS = [
  'type', 'url', 'authMode', 'tokenEnv', 'headers', 'headerEnv',
  'clientId', 'clientSecretEnv', 'clientName', 'scope', 'redirectUrl',
  'timeout', 'command', 'args', 'env', 'cwd',
];

function documentError(message, field = null) {
  return { error: message, field };
}

/**
 * Validate the document envelope and return its raw entries in document order.
 * A per-entry problem stays per-entry; this only rejects what makes the whole
 * batch meaningless.
 */
export function parseDocument(input, options = {}) {
  let value = input;
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > MAX_BYTES) {
      return documentError(`the document must be at most ${Math.floor(MAX_BYTES / 1024)} KiB`);
    }
    try {
      value = JSON.parse(input);
    } catch (error) {
      return documentError(`invalid JSON: ${error?.message ?? error}`);
    }
  } else if (input !== null && typeof input === 'object') {
    let serialized = '';
    try { serialized = JSON.stringify(input); } catch { serialized = ''; }
    if (serialized && Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) {
      return documentError(`the document must be at most ${Math.floor(MAX_BYTES / 1024)} KiB`);
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return documentError('the document must be a JSON object');
  }
  const mcpServers = value.mcpServers;
  if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) {
    return documentError('the document must carry a "mcpServers" object, for example { "mcpServers": { "name": { … } } }', 'mcpServers');
  }
  const entries = [];
  const seen = new Map();
  for (const key of Object.keys(mcpServers)) {
    const name = String(key).trim();
    if (seen.has(name)) {
      return documentError(`the document names "${seen.get(name)}" and "${key}" as the same server (names are unique after trimming)`, 'name');
    }
    seen.set(name, key);
    entries.push({ name, raw: mcpServers[key] });
  }
  if (entries.length > MAX_ENTRIES) {
    return documentError(`a batch may hold at most ${MAX_ENTRIES} entries`);
  }
  if (options.lockedName) {
    if (!seen.has(options.lockedName)) {
      return documentError(`the document must describe the server "${options.lockedName}"`, 'name');
    }
  }
  return { entries };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read the transport the document implies. The import path is the only place
 * that infers it: a Claude/Codex stdio snippet has no `type`, and the declared
 * "sse" transport is served by the HTTP transport here.
 */
export function transportOf(raw) {
  const declared = typeof raw?.type === 'string' ? raw.type.trim().toLowerCase() : '';
  if (declared === 'stdio') return { type: 'stdio', note: '' };
  if (declared === 'sse') return { type: 'http', note: 'sse-read-as-http' };
  if (declared === 'http') return { type: 'http', note: '' };
  const command = typeof raw?.command === 'string' ? raw.command.trim() : '';
  const url = typeof raw?.url === 'string' ? raw.url.trim() : '';
  if (command && !url) return { type: 'stdio', note: 'type-inferred-stdio' };
  return { type: 'http', note: '' };
}

/**
 * Normalize one entry, or report the field that makes it invalid. Unknown keys
 * are dropped by construction: the builder reads only the fields the workspace
 * declaration defines, so a pasted `oauth`/`tokens` block never reaches a file.
 *
 * `current` is the stored configuration the entry supersedes — the target
 * scope's for an update, the conflicting owner's for a `replace`. It lets the
 * builder inherit an omitted OAuth credential field and an empty `tokenEnv`
 * instead of erasing the client identity the tokens were issued to.
 */
export function normalizeEntry(name, raw, current = null) {
  if (!isValidServerName(name)) {
    return { error: { field: 'name', message: 'name must be 1-32 chars of [A-Za-z0-9_-] (it becomes the mcp__<name>__ tool prefix)' } };
  }
  if (!isPlainObject(raw)) {
    return { error: { field: 'entry', message: `"${name}" must be a JSON object` } };
  }
  const transport = transportOf(raw);
  const notes = transport.note ? [transport.note] : [];
  try {
    const { entry } = buildServerEntry({ ...raw, name, type: transport.type }, current);
    return { name, entry, notes };
  } catch (error) {
    return { error: { field: error?.field ?? 'entry', message: error?.message ?? String(error) } };
  }
}

function describeValue(value) {
  if (value === undefined) return null;
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value).length === 0 ? null : JSON.stringify(value);
  }
  return value === '' ? null : value;
}

/** The fields an update would change, with their current and proposed values. */
export function changesOf(current, entry) {
  const changes = [];
  for (const field of CHANGE_FIELDS) {
    const from = describeValue(current?.[field]);
    const to = describeValue(entry?.[field]);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes.push({ field, from, to });
  }
  return changes;
}

function compareNames(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Classify a document against a snapshot of both scopes.
 *
 * `snapshot` is `{ scope, path, mode, current, otherNames, disabled }` where
 * `current` maps a name to the stored configuration of the target scope (with
 * its stored OAuth session attached), `otherNames` maps a name to
 * `{ scope, path, enabled }` for the scope this batch is not writing, and
 * `disabled` is the set of names switched off in the target scope.
 *
 * `options.resolutions` maps a conflicting name to `keep` or `replace` and
 * `options.lockedName` restricts the batch to one server.
 */
export function planImport(entries, snapshot, options = {}) {
  const { scope, path = null, mode } = snapshot;
  const current = snapshot.current ?? new Map();
  const otherNames = snapshot.otherNames ?? new Map();
  const disabled = snapshot.disabled ?? new Set();
  // A stdio declaration without `cwd` runs in the workspace root, so a seed
  // carrying that derived value and a document omitting it are the same
  // server. Compare at that effective level; report declared changes only.
  const workspaceRoot = snapshot.workspaceRoot ?? null;
  const effective = (config) => {
    if (!config || !workspaceRoot) return config;
    if ((config.type ?? 'http') !== 'stdio' || config.cwd) return config;
    return { ...config, cwd: workspaceRoot };
  };
  const resolutions = options.resolutions ?? {};
  const lockedName = options.lockedName ?? null;
  const byName = new Map(entries.map((item) => [item.name, item]));
  const planned = [];

  for (const item of entries) {
    const base = {
      name: item.name,
      entry: null,
      changes: [],
      keepsSession: false,
      staysDisabled: disabled.has(item.name),
      conflict: null,
      resolution: null,
      error: null,
      notes: [],
    };
    if (lockedName && item.name !== lockedName) {
      planned.push({ ...base, action: 'invalid', error: { field: 'name', message: `this dialog is locked to "${lockedName}"` } });
      continue;
    }
    const stored = current.get(item.name) ?? null;
    const occupied = otherNames.get(item.name) ?? null;
    // A conflict means the target scope does not hold this name: the entry
    // inherits from the server it is about to replace.
    const normalized = normalizeEntry(item.name, item.raw, occupied?.config ?? stored);
    if (normalized.error) {
      planned.push({ ...base, action: 'invalid', error: normalized.error });
      continue;
    }
    const entry = normalized.entry;
    const notes = normalized.notes;
    if (occupied) {
      const resolution = resolutions[item.name] === 'replace' ? 'replace' : resolutions[item.name] === 'keep' ? 'keep' : null;
      const owner = { ...(occupied.config ?? {}), name: item.name, oauth: occupied.config?.oauth ?? occupied.session };
      planned.push({ ...base, action: 'conflict', entry, conflict: occupied, resolution, notes, keepsSession: keepsStoredSession(owner, entry, item.name) });
      continue;
    }
    if (!stored) {
      planned.push({ ...base, action: 'new', entry, notes });
      continue;
    }
    const entryForCompare = { ...entry, name: item.name };
    if (sameServerConfig(effective(stored), effective(entryForCompare))) {
      planned.push({ ...base, action: 'unchanged', entry, notes, keepsSession: keepsStoredSession(stored, entry, item.name) });
      continue;
    }
    planned.push({
      ...base,
      action: 'update',
      entry,
      changes: changesOf(stored, entry),
      notes,
      keepsSession: keepsStoredSession(stored, entry, item.name),
    });
  }

  if (mode === 'edit') {
    for (const name of current.keys()) {
      if (byName.has(name)) continue;
      if (lockedName && name !== lockedName) continue;
      planned.push({
        name,
        action: 'delete',
        changes: [],
        keepsSession: false,
        staysDisabled: disabled.has(name),
        conflict: null,
        resolution: null,
        error: null,
        notes: [],
      });
    }
  }

  planned.sort((a, b) => compareNames(a.name, b.name));

  const summary = { new: 0, update: 0, unchanged: 0, conflict: 0, invalid: 0, delete: 0 };
  let applyCount = 0;
  for (const item of planned) {
    summary[item.action] += 1;
    if (item.action === 'new' || item.action === 'update' || item.action === 'delete') applyCount += 1;
    else if (item.action === 'conflict' && item.resolution === 'replace') applyCount += 1;
  }
  let blocked = null;
  if (planned.some((item) => item.action === 'invalid')) blocked = 'invalid';
  else if (planned.some((item) => item.action === 'conflict' && !item.resolution)) blocked = 'conflict';

  return { scope, path, mode, entries: planned, summary, blocked, applyCount };
}
