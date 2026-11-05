/**
 * Authentication waiters for MCP tool calls.
 *
 * One entry per server key; any number of callers may wait on it, from any
 * session. The gate owns the failure deadline, the abort wiring and the
 * notifications that resume or settle the callers. It knows nothing about
 * transports, tools or plugin state: the host supplies the identity, the
 * reason and the injected ports.
 */

/** Default wait budget: two minutes from the failed call. */
export const DEFAULT_AUTH_WAIT_MS = 120000;

/** A configured budget below one second is treated as absent. */
export const MIN_AUTH_WAIT_MS = 1000;

/**
 * Settled wait outcome. `timeout`, `cancelled` and `aborted` are terminal;
 * resolution means the server was authenticated and the call may be retried.
 */
export class AuthWaitError extends Error {
  /**
   * @param outcome - terminal outcome (`timeout`, `cancelled` or `aborted`).
   * @param detail - optional human-readable detail.
   */
  constructor(outcome, detail = '') {
    super(detail || `authentication wait ${outcome}`);
    this.name = 'AuthWaitError';
    this.outcome = outcome;
  }
}

/**
 * Resolve the configured wait budget.
 * @param config - plugin configuration.
 * @returns a positive millisecond budget; the default for an absent or invalid value.
 */
export function resolveAuthWaitMs(config = {}) {
  const raw = config?.authWaitMs;
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < MIN_AUTH_WAIT_MS) return DEFAULT_AUTH_WAIT_MS;
  return Math.floor(value);
}

/**
 * Stable identity for a server across both tiers. A workspace server is keyed
 * by its workspace path and name so a global server with the same name stays a
 * different waiter entry.
 * @param server - configuration row.
 * @returns the gate key.
 */
export function serverKey(server) {
  if (server?.wsPath) return `ws:${server.wsPath}\u0000${server.name}`;
  return `id:${server?.id ?? ''}`;
}

/**
 * Create the authentication gate.
 *
 * @param options.budgetMs - wait budget per entry (default two minutes).
 * @param options.now - clock, injected for tests.
 * @param options.setTimeoutFn - timer factory, injected for tests.
 * @param options.clearTimeoutFn - timer clearer, injected for tests.
 * @param options.phaseOf - maps an entry to `needs-auth` or `authorizing`.
 */
export function createAuthGate({
  budgetMs = DEFAULT_AUTH_WAIT_MS,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  phaseOf = () => 'needs-auth',
} = {}) {
  /** @type {Map<string, object>} key -> entry */
  const entries = new Map();
  /** @type {Map<string, number>} key -> last successful authentication */
  const lastAuthAt = new Map();
  let disposed = false;

  function removeWaiter(entry, waiter) {
    entry.waiters.delete(waiter);
    if (waiter.signal && waiter.onAbort) {
      try { waiter.signal.removeEventListener('abort', waiter.onAbort); } catch {}
      waiter.onAbort = null;
    }
    if (entry.waiters.size === 0) {
      if (entry.timer !== undefined) clearTimeoutFn(entry.timer);
      entry.timer = undefined;
      if (entries.get(entry.key) === entry) entries.delete(entry.key);
    }
  }

  function settleWaiter(entry, waiter, outcome) {
    if (waiter.settled) return false;
    waiter.settled = true;
    removeWaiter(entry, waiter);
    if (outcome === null) waiter.resolve();
    else waiter.reject(new AuthWaitError(outcome));
    return true;
  }

  function expire(entry) {
    entry.timer = undefined;
    if (entries.get(entry.key) !== entry) return;
    for (const waiter of [...entry.waiters]) settleWaiter(entry, waiter, 'timeout');
    if (entry.waiters.size === 0 && entries.get(entry.key) === entry) entries.delete(entry.key);
  }

  /**
   * Wait for a server reauthorization.
   * @param wait.key - gate key from {@link serverKey}.
   * @param wait.serverId - server id for the attention listing.
   * @param wait.sessionId - session that owns the call.
   * @param wait.scope - `global` or `workspace`.
   * @param wait.workspacePath - workspace path for a workspace server.
   * @param wait.name - server name for the listing.
   * @param wait.reason - failure reason for the listing.
   * @param wait.failureAt - when the failure was observed (defaults to now).
   * @param wait.signal - caller cancellation signal.
   * @returns a promise that resolves on a completed authentication and rejects with {@link AuthWaitError}.
   */
  function block({ key, serverId, sessionId, scope, workspacePath, name, reason = '', failureAt = now(), signal } = {}) {
    if (disposed) return Promise.reject(new AuthWaitError('cancelled'));
    if (signal?.aborted) return Promise.reject(new AuthWaitError('aborted'));
    if ((lastAuthAt.get(key) ?? 0) > failureAt) return Promise.resolve();
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        key,
        serverId,
        scope: scope === 'workspace' ? 'workspace' : 'global',
        workspacePath: scope === 'workspace' ? String(workspacePath ?? '') : '',
        name: String(name ?? ''),
        reason: String(reason ?? ''),
        deadline: failureAt + budgetMs,
        timer: undefined,
        lastError: '',
        waiters: new Set(),
      };
      entry.timer = setTimeoutFn(() => expire(entry), Math.max(0, entry.deadline - now()));
      entry.timer?.unref?.();
      entries.set(key, entry);
    } else if (reason && !entry.reason) {
      entry.reason = String(reason);
    }
    return new Promise((resolve, reject) => {
      const waiter = { sessionId: String(sessionId ?? ''), resolve, reject, settled: false, signal: signal ?? null, onAbort: null };
      entry.waiters.add(waiter);
      if (signal && typeof signal.addEventListener === 'function') {
        waiter.onAbort = () => { settleWaiter(entry, waiter, 'aborted'); };
        try { signal.addEventListener('abort', waiter.onAbort, { once: true }); } catch {}
      }
    });
  }

  /**
   * Record a completed authentication for one server and resume its callers.
   * @param key - gate key from {@link serverKey}.
   * @returns how many callers were resumed.
   */
  function authenticated(key) {
    lastAuthAt.set(key, now());
    const entry = entries.get(key);
    if (!entry) return 0;
    const waiters = [...entry.waiters];
    for (const waiter of waiters) settleWaiter(entry, waiter, null);
    if (entry.waiters.size === 0 && entries.get(entry.key) === entry) entries.delete(entry.key);
    return waiters.length;
  }

  /**
   * Settle callers of one session (and one server key when given).
   * @param options.key - restrict to one server key.
   * @param options.sessionId - restrict to one session.
   * @param options.outcome - terminal outcome recorded for the callers (`cancelled` by default).
   * @returns `{ settled, remaining }` with the callers settled and those still waiting on the key.
   */
  function cancel({ key, sessionId, outcome = 'cancelled' } = {}) {
    let settled = 0;
    for (const entry of [...entries.values()]) {
      if (key !== undefined && entry.key !== key) continue;
      for (const waiter of [...entry.waiters]) {
        if (sessionId !== undefined && waiter.sessionId !== String(sessionId)) continue;
        if (settleWaiter(entry, waiter, outcome)) settled += 1;
      }
    }
    const remaining = key !== undefined ? (entries.get(key)?.waiters.size ?? 0) : 0;
    return { settled, remaining };
  }

  /**
   * Read the attention listing.
   * @returns one row per waiting server and session, with the time left.
   */
  function snapshot() {
    const rows = [];
    for (const entry of entries.values()) {
      const bySession = new Map();
      for (const waiter of entry.waiters) {
        const id = waiter.sessionId;
        bySession.set(id, (bySession.get(id) ?? 0) + 1);
      }
      const view = {
        key: entry.key,
        serverId: entry.serverId,
        scope: entry.scope,
        workspacePath: entry.workspacePath,
        name: entry.name,
        reason: entry.reason,
      };
      const phase = phaseOf(view) === 'authorizing' ? 'authorizing' : 'needs-auth';
      for (const [sessionId, pending] of bySession) {
        rows.push({
          serverId: entry.serverId,
          sessionId,
          scope: entry.scope,
          workspacePath: entry.workspacePath,
          name: entry.name,
          reason: entry.reason,
          error: entry.lastError ?? '',
          phase,
          pending,
          remainingMs: Math.max(0, entry.deadline - now()),
        });
      }
    }
    rows.sort((left, right) => left.name.localeCompare(right.name) || left.scope.localeCompare(right.scope) || left.sessionId.localeCompare(right.sessionId));
    return rows;
  }

  /** Whether one server still has callers waiting. */
  function hasWaiters(key) {
    return (entries.get(key)?.waiters.size ?? 0) > 0;
  }

  /**
   * Record the failure text of the last authorization attempt for the listing.
   * It never settles a caller; a refused attempt leaves the call waiting.
   * @param key - gate key from {@link serverKey}.
   * @param detail - already-redacted failure text.
   */
  function failed(key, detail) {
    const entry = entries.get(key);
    if (entry) entry.lastError = String(detail ?? '').slice(0, 300);
  }

  /**
   * Forget the recorded failure text, called when a new attempt starts.
   * @param key - gate key from {@link serverKey}.
   */
  function clearFailure(key) {
    const entry = entries.get(key);
    if (entry) entry.lastError = '';
  }

  /** Settle every caller (plugin unload) and forget every entry. */
  function dispose() {
    disposed = true;
    for (const entry of [...entries.values()]) {
      for (const waiter of [...entry.waiters]) settleWaiter(entry, waiter, 'cancelled');
    }
    entries.clear();
    lastAuthAt.clear();
  }

  return { budgetMs, block, authenticated, cancel, snapshot, hasWaiters, failed, clearFailure, dispose };
}
