/**
 * OAuth session registry (v0.18.0).
 *
 * The `state` is the routing key and the replay guard at once: one flow, one
 * state, one use. These tests drive the clock directly instead of sleeping.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';

const { createSessionStore, SESSION_TTL_MS } = await import('../lib/oauth/session-store.js');

function flow(serverId = 'srv-1', overrides = {}) {
  return {
    serverId,
    serverName: 'fixture',
    wsPath: '',
    clientId: 'client-1',
    redirectUri: 'http://localhost:1234/callback',
    verifier: 'verifier-1',
    challenge: 'challenge-1',
    callbackPort: '1234',
    callbackPath: '/callback',
    returnUrl: 'http://127.0.0.1:3080/',
    ...overrides,
  };
}

it('creates a pending session with a unique, unpredictable state', () => {
  const store = createSessionStore();
  const states = new Set();
  for (let index = 0; index < 200; index += 1) {
    const state = store.create(flow());
    assert.ok(state.length >= 40, `state ${state} must be long enough to be unguessable`);
    assert.match(state, /^[A-Za-z0-9_-]+$/, 'the state is URL-safe base64url');
    assert.ok(!states.has(state), 'states are unique');
    states.add(state);
  }
  assert.equal(store.size, 200);
});

it('consumes a state exactly once and reports a replay as consumed', () => {
  const store = createSessionStore();
  const state = store.create(flow());
  const first = store.consume(state);
  assert.equal(first.status, 'ok');
  assert.equal(first.session.serverId, 'srv-1');
  assert.equal(store.size, 0);
  const replay = store.consume(state);
  assert.equal(replay.status, 'consumed', 'a replayed callback must be distinguishable from an unknown state');
  assert.equal(replay.session, undefined);
});

it('reports an unknown state and an empty state as unknown', () => {
  const store = createSessionStore();
  assert.equal(store.consume('not-a-state').status, 'unknown');
  assert.equal(store.consume('').status, 'unknown');
  assert.equal(store.consume(null).status, 'unknown');
});

it('expires a session ten minutes after it was created', () => {
  let now = 1_000_000;
  const store = createSessionStore({ now: () => now });
  const state = store.create(flow());
  now += SESSION_TTL_MS - 1;
  assert.equal(store.consume(state).status, 'ok');

  const second = store.create(flow('srv-2'));
  now += SESSION_TTL_MS + 1;
  const expired = store.consume(second);
  assert.equal(expired.status, 'expired');
  assert.equal(expired.session.serverId, 'srv-2');
});

it('reports a reaped session as expired, not as already completed', () => {
  let now = 0;
  const store = createSessionStore({ now: () => now });
  const state = store.create(flow());
  now = SESSION_TTL_MS + 1;
  assert.equal(store.expire().length, 1);
  assert.equal(store.consume(state).status, 'expired', 'the reaper must not turn an expired state into a replay');
});

it('remove() drops one session by state and reports it as consumed', () => {
  const store = createSessionStore();
  const state = store.create(flow());
  const removed = store.remove(state);
  assert.equal(removed.serverId, 'srv-1');
  assert.equal(store.pendingFor('srv-1').length, 0);
  assert.equal(store.consume(state).status, 'consumed');
  assert.equal(store.remove(state), null);
});

it('expire() returns the elapsed sessions so their listeners can be released', () => {
  let now = 0;
  const store = createSessionStore({ now: () => now });
  store.create(flow('srv-1'));
  store.create(flow('srv-2'));
  assert.deepEqual(store.expire(), []);
  now = SESSION_TTL_MS + 1;
  const expired = store.expire();
  assert.deepEqual(expired.map((session) => session.serverId).sort(), ['srv-1', 'srv-2']);
  assert.equal(store.size, 0);
  assert.equal(store.expire().length, 0, 'expiry is idempotent');
});

it('keeps concurrent sessions for different connections independent', () => {
  const store = createSessionStore();
  const first = store.create(flow('srv-1'));
  const second = store.create(flow('srv-2'));
  const consumed = store.consume(second);
  assert.equal(consumed.session.serverId, 'srv-2');
  assert.equal(store.pendingFor('srv-1').length, 1, 'the sibling flow is untouched');
  assert.equal(store.consume(first).status, 'ok');
});

it('supports several concurrent flows for the same connection', () => {
  const store = createSessionStore();
  const first = store.create(flow('srv-1'));
  const second = store.create(flow('srv-1'));
  assert.notEqual(first, second);
  assert.equal(store.pendingFor('srv-1').length, 2);
  assert.equal(store.consume(first).status, 'ok');
  assert.equal(store.pendingFor('srv-1').length, 1, 'consuming one flow leaves the other pending');
  assert.equal(store.consume(second).status, 'ok');
});

it('removeFor drops only the named connection and keeps the rest', () => {
  const store = createSessionStore();
  store.create(flow('srv-1'));
  store.create(flow('srv-1'));
  const kept = store.create(flow('srv-2'));
  const removed = store.removeFor('srv-1');
  assert.equal(removed.length, 2);
  assert.equal(store.pendingFor('srv-1').length, 0);
  assert.equal(store.consume(kept).status, 'ok');
});

it('clear() discards every pending session and its tombstones', () => {
  const store = createSessionStore();
  const state = store.create(flow());
  store.consume(state);
  store.create(flow('srv-2'));
  store.clear();
  assert.equal(store.size, 0);
  assert.equal(store.consume(state).status, 'unknown', 'a restart must not remember an old state');
});

it('records the full flow context on the session', () => {
  const store = createSessionStore();
  const state = store.create(flow('srv-9', { wsPath: '/ws', callbackPort: '4321', callbackPath: '/gh' }));
  const { session } = store.consume(state);
  assert.equal(session.serverId, 'srv-9');
  assert.equal(session.serverName, 'fixture');
  assert.equal(session.wsPath, '/ws');
  assert.equal(session.clientId, 'client-1');
  assert.equal(session.redirectUri, 'http://localhost:1234/callback');
  assert.equal(session.verifier, 'verifier-1');
  assert.equal(session.challenge, 'challenge-1');
  assert.equal(session.callbackPort, '4321');
  assert.equal(session.callbackPath, '/gh');
  assert.equal(session.status, 'pending');
  assert.ok(session.expiresAt > session.createdAt);
});
