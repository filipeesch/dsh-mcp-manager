/**
 * Authentication gate semantics (v0.21.0).
 *
 * A fake clock and fake timers keep the wait rules deterministic: the gate owns
 * the deadline, the abort wiring and the notifications that settle callers.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthWaitError, createAuthGate, resolveAuthWaitMs, serverKey, DEFAULT_AUTH_WAIT_MS } from '../lib/auth/gate.js';

function fakeTimers(start = 1_000_000) {
  let current = start;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => current,
    setTimeoutFn(fn, delay) {
      const id = ++seq;
      timers.set(id, { fn, at: current + Math.max(0, delay) });
      return id;
    },
    clearTimeoutFn(id) { timers.delete(id); },
    tick(ms) {
      const target = current + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        current = due[1].at;
        due[1].fn();
      }
      current = target;
    },
    pending: () => timers.size,
  };
}

const SERVER = { id: 'srv-1', name: 'database' };
const KEY = serverKey(SERVER);

function baseWait(overrides = {}) {
  return { key: KEY, serverId: SERVER.id, sessionId: 'session-a', scope: 'global', name: SERVER.name, reason: 'invalid_token', failureAt: 1_000_000, ...overrides };
}

describe('resolveAuthWaitMs', () => {
  it('defaults, accepts numeric strings and floors invalid values', () => {
    assert.equal(resolveAuthWaitMs({}), DEFAULT_AUTH_WAIT_MS);
    assert.equal(resolveAuthWaitMs({ authWaitMs: 300000 }), 300000);
    assert.equal(resolveAuthWaitMs({ authWaitMs: '2500' }), 2500);
    assert.equal(resolveAuthWaitMs({ authWaitMs: 999 }), DEFAULT_AUTH_WAIT_MS);
    assert.equal(resolveAuthWaitMs({ authWaitMs: 0 }), DEFAULT_AUTH_WAIT_MS);
    assert.equal(resolveAuthWaitMs({ authWaitMs: -5 }), DEFAULT_AUTH_WAIT_MS);
    assert.equal(resolveAuthWaitMs({ authWaitMs: NaN }), DEFAULT_AUTH_WAIT_MS);
    assert.equal(resolveAuthWaitMs({ authWaitMs: Infinity }), DEFAULT_AUTH_WAIT_MS);
    assert.equal(resolveAuthWaitMs({ authWaitMs: 'oops' }), DEFAULT_AUTH_WAIT_MS);
  });
});

describe('serverKey', () => {
  it('separates a global server from a workspace server of the same name', () => {
    assert.equal(serverKey({ id: 'a', name: 'database' }), 'id:a');
    assert.equal(serverKey({ id: 'a', name: 'database', wsPath: '/repo' }), 'ws:/repo\u0000database');
    assert.notEqual(serverKey({ id: 'a', name: 'database' }), serverKey({ id: 'b', name: 'database', wsPath: '/repo' }));
  });
});

describe('auth gate', () => {
  it('shares one entry and one deadline between callers of a server', async () => {
    const timers = fakeTimers();
    const gate = createAuthGate({ budgetMs: 5000, now: timers.now, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
    const first = gate.block(baseWait());
    const second = gate.block(baseWait({ sessionId: 'session-b' }));
    const rows = gate.snapshot();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.pending), [1, 1]);
    assert.equal(timers.pending(), 1);
    gate.authenticated(KEY);
    await Promise.all([first, second]);
    assert.deepEqual(gate.snapshot(), []);
    assert.equal(timers.pending(), 0);
  });

  it('settles every caller at the budget and clears the listing', async () => {
    const timers = fakeTimers();
    const gate = createAuthGate({ budgetMs: 1000, now: timers.now, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
    const first = gate.block(baseWait());
    const second = gate.block(baseWait({ sessionId: 'session-b' }));
    timers.tick(1000);
    await assert.rejects(first, (error) => error instanceof AuthWaitError && error.outcome === 'timeout');
    await assert.rejects(second, (error) => error.outcome === 'timeout');
    assert.deepEqual(gate.snapshot(), []);
    assert.equal(timers.pending(), 0);
  });

  it('resumes immediately when the server authenticated after the failure', async () => {
    const timers = fakeTimers();
    const gate = createAuthGate({ budgetMs: 1000, now: timers.now, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
    timers.tick(50);
    gate.authenticated(KEY);
    await gate.block(baseWait({ failureAt: 1_000_000 }));
    assert.equal(timers.pending(), 0);
    assert.deepEqual(gate.snapshot(), []);
  });

  it('cancels one session without touching another', async () => {
    const timers = fakeTimers();
    const gate = createAuthGate({ budgetMs: 1000, now: timers.now, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
    const mine = gate.block(baseWait({ sessionId: 'session-a' }));
    const other = gate.block(baseWait({ sessionId: 'session-b' }));
    const result = gate.cancel({ key: KEY, sessionId: 'session-a' });
    assert.equal(result.settled, 1);
    assert.equal(result.remaining, 1);
    await assert.rejects(mine, (error) => error.outcome === 'cancelled');
    assert.equal(gate.snapshot()[0].pending, 1);
    gate.authenticated(KEY);
    await other;
  });

  it('settles an aborted caller and releases its entry', async () => {
    const timers = fakeTimers();
    const gate = createAuthGate({ budgetMs: 1000, now: timers.now, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
    const controller = new AbortController();
    const waiting = gate.block(baseWait({ signal: controller.signal }));
    controller.abort();
    await assert.rejects(waiting, (error) => error.outcome === 'aborted');
    assert.equal(timers.pending(), 0);
    assert.deepEqual(gate.snapshot(), []);
  });

  it('settles an already-aborted signal without creating an entry', async () => {
    const timers = fakeTimers();
    const gate = createAuthGate({ budgetMs: 1000, now: timers.now, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(gate.block(baseWait({ signal: controller.signal })), (error) => error.outcome === 'aborted');
    assert.equal(timers.pending(), 0);
    assert.deepEqual(gate.snapshot(), []);
  });

  it('disposes every caller and every timer', async () => {
    const timers = fakeTimers();
    const gate = createAuthGate({ budgetMs: 5000, now: timers.now, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
    const first = gate.block(baseWait({ key: 'id:a', serverId: 'a' }));
    const second = gate.block(baseWait({ key: 'id:b', serverId: 'b' }));
    gate.dispose();
    await assert.rejects(first, (error) => error.outcome === 'cancelled');
    await assert.rejects(second, (error) => error.outcome === 'cancelled');
    assert.deepEqual(gate.snapshot(), []);
    assert.equal(timers.pending(), 0);
  });

  it('reports the listing shape, phase and remaining time without mutating state', async () => {
    const timers = fakeTimers();
    let authorizing = false;
    const gate = createAuthGate({
      budgetMs: 5000,
      now: timers.now,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
      phaseOf: () => (authorizing ? 'authorizing' : 'needs-auth'),
    });
    const waiting = gate.block(baseWait({ scope: 'workspace', workspacePath: '/repo', sessionId: 'session-a' }));
    timers.tick(1000);
    const first = gate.snapshot();
    assert.deepEqual(Object.keys(first[0]).sort(), ['error', 'name', 'pending', 'phase', 'reason', 'remainingMs', 'scope', 'serverId', 'sessionId', 'workspacePath']);
    assert.equal(first[0].phase, 'needs-auth');
    assert.equal(first[0].scope, 'workspace');
    assert.equal(first[0].workspacePath, '/repo');
    assert.equal(first[0].remainingMs, 4000);
    authorizing = true;
    assert.equal(gate.snapshot()[0].phase, 'authorizing');
    assert.deepEqual(gate.snapshot(), gate.snapshot());
    gate.failed(KEY, 'provider said no');
    assert.equal(gate.snapshot()[0].error, 'provider said no');
    gate.clearFailure(KEY);
    assert.equal(gate.snapshot()[0].error, '');
    gate.cancel({ key: KEY, sessionId: 'session-a', outcome: 'disabled' });
    await assert.rejects(waiting, (error) => error.outcome === 'disabled');
  });

  it('never lists a server that is not waiting', () => {
    const timers = fakeTimers();
    const gate = createAuthGate({ budgetMs: 5000, now: timers.now, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
    assert.deepEqual(gate.snapshot(), []);
    gate.failed(KEY, 'ignored: no entry');
    assert.deepEqual(gate.snapshot(), []);
  });
});
