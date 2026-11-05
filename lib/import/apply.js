import { keepsStoredSession, patchServerRow } from '../servers/config.js';

/**
 * Apply a validated import plan.
 *
 * Every side effect goes through `ports`, so a test can apply a plan against
 * plain objects and the plugin can pass the real state file, workspace writer,
 * rescan and connection functions. The planner already decided what each entry
 * means; this module only executes it.
 *
 * Order is deliberate and non-destructive:
 *   1. the target scope is written and persisted — the new configuration exists
 *      before anything is removed;
 *   2. only then is a conflicting owner evicted, and a `replace` has already
 *      carried its session over;
 *   3. workspace files are written after the profile tier is persisted, matching
 *      the rest of the host.
 * A failure between the steps can leave two entries with the same name — a
 * visible, recoverable conflict — but it can never delete a server whose
 * replacement was not written yet.
 */

function pruneName(raw, name, list) {
  if (!Array.isArray(raw[list])) return;
  const next = [...new Set(raw[list]
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))]
    .filter((value) => value !== name);
  if (next.length > 0) raw[list] = next;
  else delete raw[list];
}

export async function applyPlan(plan, ports) {
  if (plan.blocked) {
    throw new Error(plan.blocked === 'invalid'
      ? 'the batch has invalid entries; nothing was written'
      : 'the batch has undecided conflicts; nothing was written');
  }

  const documents = new Map();
  const touched = new Set();
  const pendingWrites = new Set();
  const applied = [];
  const toConnect = [];
  let globalDirty = false;

  const documentOf = (path) => {
    if (!documents.has(path)) documents.set(path, ports.readWorkspaceRaw(path) ?? {});
    return documents.get(path);
  };
  const serversOf = (raw, path) => {
    if (Array.isArray(raw.mcpServers)) throw new Error(`invalid ${path}: "mcpServers" must be an object`);
    if (!raw.mcpServers || typeof raw.mcpServers !== 'object') raw.mcpServers = {};
    return raw.mcpServers;
  };
  // A workspace session lives in the state file, so writing or clearing one is
  // a state change exactly like a profile row edit.
  const setToken = (path, name, session) => {
    ports.setWorkspaceToken(path, name, session);
    globalDirty = true;
  };
  const flush = async () => {
    if (globalDirty) {
      await ports.saveState();
      globalDirty = false;
    }
    for (const path of pendingWrites) ports.writeWorkspaceRaw(path, documents.get(path));
    pendingWrites.clear();
  };

  // Capture what a `replace` needs before anything is created: the owner's
  // configuration (the inheritance source for the entry) and its session.
  const captures = new Map();
  for (const item of plan.entries) {
    if (item.action !== 'conflict' || item.resolution !== 'replace') continue;
    const owner = item.conflict;
    if (owner.scope === 'global') {
      const row = ports.findGlobal(item.name);
      captures.set(item.name, { owner, row: row ?? null, config: { ...(owner.config ?? row ?? {}) }, session: row?.oauth ?? null });
    } else {
      captures.set(item.name, {
        owner,
        row: null,
        config: { ...(owner.config ?? {}) },
        session: ports.workspaceToken(owner.path, item.name) ?? null,
      });
    }
  }
  const migrated = new Map();
  for (const item of plan.entries) {
    if (item.action !== 'conflict' || item.resolution !== 'replace') continue;
    const capture = captures.get(item.name);
    const holder = { ...capture.config, name: item.name, oauth: capture.session };
    if (capture.session && keepsStoredSession(holder, item.entry, item.name)) migrated.set(item.name, capture.session);
  }

  // 1. The target scope.
  for (const item of plan.entries) {
    if (item.action === 'delete') {
      if (plan.scope === 'global') {
        const row = ports.findGlobal(item.name);
        if (!row) continue;
        if (ports.cancelSessions) await ports.cancelSessions(row.id, 'server removed by an edit');
        ports.disconnect(row);
        if (ports.clearAttempts) ports.clearAttempts(row.id);
        ports.removeGlobal(row);
        globalDirty = true;
      } else {
        const raw = documentOf(plan.path);
        const servers = serversOf(raw, plan.path);
        if (Object.prototype.hasOwnProperty.call(servers, item.name)) delete servers[item.name];
        if (!ports.isGlobalName?.(item.name)) {
          pruneName(raw, item.name, 'disabled');
          pruneName(raw, item.name, 'exclude');
        }
        // The declaration is gone, so its stored registration must go too:
        // leaving the slot behind would re-attach a stale secret on a re-add.
        setToken(plan.path, item.name, null);
        pendingWrites.add(plan.path);
        touched.add(plan.path);
      }
      applied.push(item);
      continue;
    }
    if (item.action !== 'new' && item.action !== 'update' && item.action !== 'conflict') continue;
    if (item.action === 'conflict' && item.resolution !== 'replace') continue;

    if (plan.scope === 'global') {
      const row = ports.findGlobal(item.name);
      if (row) {
        ports.disconnect(row);
        const keep = keepsStoredSession(row, item.entry, item.name);
        patchServerRow(row, item.entry);
        if (!keep) delete row.oauth;
        if (row.enabled !== false) toConnect.push(row);
      } else {
        const created = { id: ports.newId ? ports.newId() : item.name, name: item.name, ...item.entry };
        const session = migrated.get(item.name);
        if (session) created.oauth = session;
        ports.addGlobal(created);
        if (created.enabled !== false) toConnect.push(created);
      }
      globalDirty = true;
    } else {
      const raw = documentOf(plan.path);
      const servers = serversOf(raw, plan.path);
      servers[item.name] = item.entry;
      const session = migrated.get(item.name);
      if (session) setToken(plan.path, item.name, session);
      else if (!item.keepsSession) setToken(plan.path, item.name, null);
      pendingWrites.add(plan.path);
      touched.add(plan.path);
    }
    applied.push(item);
  }

  // 2. Persist the profile tier first, then the workspace files.
  await flush();

  // 3. Evict the owner of a replaced name — after its replacement is durable.
  for (const [name, capture] of captures) {
    if (capture.owner.scope === 'global') {
      const row = ports.findGlobal(name);
      if (!row) continue;
      if (ports.cancelSessions) await ports.cancelSessions(row.id, 'server replaced by an import');
      ports.disconnect(row);
      if (ports.clearAttempts) ports.clearAttempts(row.id);
      ports.removeGlobal(row);
      globalDirty = true;
    } else {
      const raw = documentOf(capture.owner.path);
      const servers = serversOf(raw, capture.owner.path);
      if (Object.prototype.hasOwnProperty.call(servers, name)) delete servers[name];
      if (!ports.isGlobalName?.(name)) {
        pruneName(raw, name, 'disabled');
        pruneName(raw, name, 'exclude');
      }
      setToken(capture.owner.path, name, null);
      pendingWrites.add(capture.owner.path);
      touched.add(capture.owner.path);
    }
  }
  if (pendingWrites.size > 0 || globalDirty) await flush();

  // 4. Reconcile the workspace tier: the rescan connects what changed, keeps a
  //    disabled entry disconnected, and drops a removed entry's row.
  for (const path of touched) {
    if (ports.rescan) await ports.rescan(path);
  }

  // 5. Reconnect the profile tier, never a server the operator disabled.
  for (const row of toConnect) {
    if (ports.connect) await ports.connect(row);
  }

  return { ...plan, applied: applied.map((item) => item.name), appliedCount: applied.length };
}
