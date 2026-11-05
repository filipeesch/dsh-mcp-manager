/**
 * Tool-call authentication recovery (v0.21.0).
 *
 * The orchestration is exercised with a fake call and a fake gate: the first
 * attempt, the wait, the single retry and the actionable error are the unit
 * under test, independent of transports and plugin state.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthWaitError } from '../lib/auth/gate.js';
import {
  AuthRequiredError,
  authFailureMessage,
  canBrowserAuthorize,
  isAuthRequiredError,
  sessionIdOf,
  withAuthRecovery,
} from '../lib/auth/recovery.js';

const OAUTH_SERVER = { id: 'srv-1', name: 'database', authMode: 'oauth', type: 'http' };
const STATIC_SERVER = { id: 'srv-2', name: 'internal', authMode: 'static', type: 'http' };
const WORKSPACE_SERVER = { id: 'ws-1', name: 'database', authMode: 'oauth', type: 'http', wsPath: '/repo' };

function fakeGate({ outcome = 'resolve', budgetMs = 120000 } = {}) {
  const calls = [];
  return {
    budgetMs,
    calls,
    async block(args) {
      calls.push(args);
      if (outcome === 'resolve') return;
      throw new AuthWaitError(outcome);
    },
  };
}

function authError(reason = 'invalid_token') {
  return new AuthRequiredError(`MCP tools/call HTTP 401: ${reason}`, { kind: 'unauthorized', reason });
}

describe('authentication errors', () => {
  it('classifies only the typed rejection', () => {
    assert.equal(isAuthRequiredError(authError()), true);
    assert.equal(isAuthRequiredError(new Error('MCP tools/call HTTP 401: invalid_token')), false);
    assert.equal(isAuthRequiredError(null), false);
  });

  it('tells which servers can be authorized in a browser', () => {
    assert.equal(canBrowserAuthorize(OAUTH_SERVER), true);
    assert.equal(canBrowserAuthorize(STATIC_SERVER), false);
    assert.equal(canBrowserAuthorize({ id: 'x', name: 'local', type: 'stdio', authMode: 'oauth' }), false);
  });

  it('reads the owning session from either agent field', () => {
    assert.equal(sessionIdOf({ agent: { id: 'session-a' } }), 'session-a');
    assert.equal(sessionIdOf({ agent: { sessionId: 'session-b' } }), 'session-b');
    assert.equal(sessionIdOf({}), '');
    assert.equal(sessionIdOf(undefined), '');
  });
});

describe('withAuthRecovery', () => {
  it('returns a healthy call without touching the gate', async () => {
    const gate = fakeGate();
    let marked = 0;
    const result = await withAuthRecovery({ call: async () => ({ text: 'ok' }), gate, server: OAUTH_SERVER, exec: {}, onAuthRequired: () => { marked += 1; } });
    assert.deepEqual(result, { text: 'ok' });
    assert.equal(gate.calls.length, 0);
    assert.equal(marked, 0);
  });

  it('rethrows a non-authentication failure unchanged', async () => {
    const gate = fakeGate();
    const failure = new Error('MCP tools/call timeout after 60000ms');
    await assert.rejects(withAuthRecovery({ call: async () => { throw failure; }, gate, server: OAUTH_SERVER, exec: {} }), (error) => error === failure);
    assert.equal(gate.calls.length, 0);
  });

  it('waits for an OAuth server and retries once with the same call', async () => {
    const gate = fakeGate();
    const attempts = [];
    const marks = [];
    const result = await withAuthRecovery({
      call: async () => {
        attempts.push(attempts.length);
        if (attempts.length === 1) throw authError();
        return { text: 'listed', attempt: attempts.length };
      },
      gate,
      server: OAUTH_SERVER,
      exec: { agent: { id: 'session-a' } },
      onAuthRequired: (error) => marks.push(error.reason),
    });
    assert.deepEqual(result, { text: 'listed', attempt: 2 });
    assert.equal(attempts.length, 2);
    assert.deepEqual(marks, ['invalid_token']);
    assert.equal(gate.calls.length, 1);
    assert.deepEqual(gate.calls[0], {
      key: 'id:srv-1',
      serverId: 'srv-1',
      sessionId: 'session-a',
      scope: 'global',
      workspacePath: '',
      name: 'database',
      reason: 'invalid_token',
      failureAt: gate.calls[0].failureAt,
      signal: undefined,
    });
    assert.equal(typeof gate.calls[0].failureAt, 'number');
  });

  it('attributes a workspace call to its workspace', async () => {
    const gate = fakeGate();
    let attempts = 0;
    await withAuthRecovery({
      call: async () => { attempts += 1; if (attempts === 1) throw authError(); return { text: 'ok' }; },
      gate,
      server: WORKSPACE_SERVER,
      exec: { agent: { id: 'session-w' } },
    });
    assert.equal(gate.calls[0].key, 'ws:/repo\u0000database');
    assert.equal(gate.calls[0].scope, 'workspace');
    assert.equal(gate.calls[0].workspacePath, '/repo');
  });

  it('marks a static server and fails immediately without waiting', async () => {
    const gate = fakeGate();
    const marks = [];
    await assert.rejects(
      withAuthRecovery({ call: async () => { throw authError(); }, gate, server: STATIC_SERVER, exec: {}, onAuthRequired: (error) => marks.push(error.reason) }),
      /does not use browser authorization.*Settings → MCP/s,
    );
    assert.equal(gate.calls.length, 0);
    assert.deepEqual(marks, ['invalid_token']);
  });

  it('turns a timeout into the actionable error', async () => {
    const gate = fakeGate({ outcome: 'timeout', budgetMs: 120000 });
    let attempts = 0;
    await assert.rejects(
      withAuthRecovery({ call: async () => { attempts += 1; throw authError(); }, gate, server: OAUTH_SERVER, exec: {} }),
      (error) => {
        assert.match(error.message, /MCP server "database"/);
        assert.match(error.message, /call was not executed/);
        assert.match(error.message, /within 120s/);
        assert.match(error.message, /conversation banner/);
        assert.match(error.message, /Settings → MCP/);
        return true;
      },
    );
    assert.equal(attempts, 1);
  });

  it('turns a cancellation into the actionable error', async () => {
    const gate = fakeGate({ outcome: 'cancelled' });
    await assert.rejects(withAuthRecovery({ call: async () => { throw authError(); }, gate, server: OAUTH_SERVER, exec: {} }), /authorization was cancelled/);
  });

  it('turns a disabled server into the actionable error', async () => {
    const gate = fakeGate({ outcome: 'disabled' });
    await assert.rejects(withAuthRecovery({ call: async () => { throw authError(); }, gate, server: OAUTH_SERVER, exec: {} }), /was disabled while the call waited/);
  });

  it('surfaces an abort as an interruption, not as an authentication error', async () => {
    const gate = fakeGate({ outcome: 'aborted' });
    await assert.rejects(
      withAuthRecovery({ call: async () => { throw authError(); }, gate, server: OAUTH_SERVER, exec: {} }),
      (error) => error.name === 'AbortError' && /interrupted/.test(error.message),
    );
  });

  it('fails without a second wait when the retried call is rejected again', async () => {
    const gate = fakeGate();
    let attempts = 0;
    await assert.rejects(
      withAuthRecovery({ call: async () => { attempts += 1; throw authError(attempts === 1 ? 'invalid_token' : 'invalid_scope'); }, gate, server: OAUTH_SERVER, exec: {} }),
      /still rejected the call after reauthorization \(invalid_scope\)/,
    );
    assert.equal(attempts, 2);
    assert.equal(gate.calls.length, 1);
  });

  it('rethrows a non-authentication failure from the retry unchanged', async () => {
    const gate = fakeGate();
    const failure = new Error('MCP tools/call timeout after 60000ms');
    let attempts = 0;
    await assert.rejects(
      withAuthRecovery({ call: async () => { attempts += 1; if (attempts === 1) throw authError(); throw failure; }, gate, server: OAUTH_SERVER, exec: {} }),
      (error) => error === failure,
    );
  });

  it('redacts provider text before it reaches the gate or the error', async () => {
    const gate = fakeGate({ outcome: 'timeout' });
    const redact = (text) => String(text).replace('Bearer abc123', 'Bearer <redacted>');
    await assert.rejects(
      withAuthRecovery({ call: async () => { throw authError('Bearer abc123 rejected'); }, gate, server: OAUTH_SERVER, exec: {}, redact }),
      (error) => !error.message.includes('abc123'),
    );
    assert.equal(gate.calls[0].reason, 'Bearer <redacted> rejected');
  });
});

describe('authFailureMessage', () => {
  it('never recommends the chat banner for a server without a browser flow', () => {
    const message = authFailureMessage(STATIC_SERVER, { outcome: 'no-auth-flow' });
    assert.match(message, /Settings → MCP/);
    assert.doesNotMatch(message, /conversation banner/);
  });

  it('keeps the timeout wording bounded by the configured budget', () => {
    assert.match(authFailureMessage(OAUTH_SERVER, { outcome: 'timeout', budgetMs: 5000 }), /within 5s/);
    assert.match(authFailureMessage(OAUTH_SERVER, { outcome: 'timeout', budgetMs: 0 }), /within 1s/);
  });
});
