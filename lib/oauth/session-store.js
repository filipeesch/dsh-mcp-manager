/**
 * Pending OAuth authorization sessions, keyed by their unique `state`.
 *
 * The state is the only routing key: an authorization attempt is independent of
 * a server id, so several flows can be pending for the same MCP connection and
 * a callback can never be addressed to a server. The store is deliberately
 * in-memory — a pending authorization is not worth a secret-at-rest surface,
 * and "a restart leaves nothing pending" is a requirement.
 */

import { randomBytes } from 'node:crypto';

export const SESSION_TTL_MS = 10 * 60 * 1000;

function newState() {
  return randomBytes(32).toString('base64url');
}

/**
 * @param {{ now?: () => number, ttlMs?: number, makeState?: () => string }} [options]
 */
export function createSessionStore({ now = Date.now, ttlMs = SESSION_TTL_MS, makeState = newState } = {}) {
  /** @type {Map<string, object>} */
  const sessions = new Map();
  /**
   * States that are gone, with the outcome a late callback should report:
   * `consumed` for a completed flow, `expired` for one the clock took.
   * @type {Map<string, { until: number, outcome: 'consumed'|'expired' }>}
   */
  const tombstones = new Map();

  function remember(state, outcome = 'consumed') {
    tombstones.set(state, { until: now() + ttlMs, outcome });
  }

  function pruneTombstones() {
    const current = now();
    for (const [state, entry] of tombstones) if (entry.until <= current) tombstones.delete(state);
  }

  return {
    /** Register a pending authorization and return its state. */
    create(session) {
      const state = makeState();
      const createdAt = now();
      sessions.set(state, {
        ...session,
        state,
        createdAt,
        expiresAt: createdAt + ttlMs,
        status: 'pending',
      });
      return state;
    },

    /**
     * Consume a state exactly once.
     * @returns {{status: 'ok'|'unknown'|'expired'|'consumed', session?: object}}
     */
    consume(state) {
      const key = String(state ?? '');
      if (!key) return { status: 'unknown' };
      const session = sessions.get(key);
      if (!session) {
        pruneTombstones();
        const tombstone = tombstones.get(key);
        return { status: tombstone ? tombstone.outcome : 'unknown' };
      }
      sessions.delete(key);
      // A callback that arrives after the deadline is expired even when the
      // reaper has not run yet; both paths must say the same thing.
      const expired = now() >= session.expiresAt;
      remember(key, expired ? 'expired' : 'consumed');
      return expired ? { status: 'expired', session } : { status: 'ok', session };
    },

    /** Pending sessions that belong to one MCP connection. */
    pendingFor(serverId) {
      const id = String(serverId ?? '');
      if (!id) return [];
      return [...sessions.values()].filter((session) => session.serverId === id);
    },

    /** Every pending session, oldest first. */
    list() {
      return [...sessions.values()].sort((left, right) => left.createdAt - right.createdAt);
    },

    /** Remove and return one session by its state, e.g. a failed authorization start. */
    remove(state) {
      const key = String(state ?? '');
      const session = sessions.get(key);
      if (!session) return null;
      sessions.delete(key);
      remember(key);
      return session;
    },

    /** Remove and return the sessions of one connection, e.g. on delete/disable. */
    removeFor(serverId) {
      const removed = this.pendingFor(serverId);
      for (const session of removed) {
        sessions.delete(session.state);
        remember(session.state);
      }
      return removed;
    },

    /** Drop every session whose TTL elapsed; returns them so callers can release listeners. */
    expire() {
      const current = now();
      const expired = [];
      for (const [state, session] of sessions) {
        if (current < session.expiresAt) continue;
        sessions.delete(state);
        remember(state, 'expired');
        expired.push(session);
      }
      pruneTombstones();
      return expired;
    },

    /** Discard every pending session without recording a reusable state. */
    clear() {
      sessions.clear();
      tombstones.clear();
    },

    get size() {
      return sessions.size;
    },
  };
}
