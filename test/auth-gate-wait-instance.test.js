/**
 * Wait instance identity: a later wait for the same session is a NEW id.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';

import { createAuthGate } from '../lib/auth/gate.js';

function base(overrides = {}) {
  return {
    key: 'k1',
    serverId: 'srv-1',
    sessionId: 'a',
    scope: 'global',
    name: 'database',
    reason: 'invalid_token',
    failureAt: 1000,
    ...overrides,
  };
}

it('mints a distinct id for each session of one server', () => {
  const gate = createAuthGate({ budgetMs: 60000, now: () => 1000, setTimeoutFn: () => 1, clearTimeoutFn: () => {} });
  gate.block(base({ sessionId: 'a' })).catch(() => {});
  gate.block(base({ sessionId: 'b' })).catch(() => {});
  const rows = gate.snapshot();
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].waitId, rows[1].waitId);
  gate.dispose();
});

it('mints a new id when the same session waits again', () => {
  const gate = createAuthGate({ budgetMs: 60000, now: () => 1000, setTimeoutFn: () => 1, clearTimeoutFn: () => {} });
  gate.block(base({ sessionId: 'a' })).catch(() => {});
  const first = gate.snapshot()[0].waitId;
  gate.cancel({ key: 'k1', sessionId: 'a' });
  gate.block(base({ sessionId: 'a' })).catch(() => {});
  const second = gate.snapshot()[0].waitId;
  assert.notEqual(first, second, 'a returning session is a new wait instance');
  gate.dispose();
});
it('does not collide when a key or a session contains the separator', () => {
  // `id:x@y` with session `z` and `id:x` with session `y@z` are different pairs.
  const gate = createAuthGate({ budgetMs: 60000, now: () => 1000, setTimeoutFn: () => 1, clearTimeoutFn: () => {} });
  gate.block(base({ key: 'id:x@y', sessionId: 'z' })).catch(() => {});
  gate.block(base({ key: 'id:x', sessionId: 'y@z' })).catch(() => {});
  const rows = gate.snapshot();
  assert.equal(rows.length, 2, 'two pairs produce two rows');
  assert.notEqual(rows[0].waitId, rows[1].waitId, 'the two pairs must not share an instance id');
  gate.dispose();
});
