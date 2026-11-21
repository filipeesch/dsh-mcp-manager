/**
 * The dead-session predicate.
 *
 * It decides whether a rejection means the server forgot the transport session,
 * which is the only case worth a reconnect and a replay. A session-shaped
 * payload error must not qualify.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isDeadSession } from '../lib/transport/http.js';

describe('isDeadSession', () => {
  it('recognises the shapes servers actually produce', () => {
    const notFound = JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message: 'Session not found' } });
    assert.equal(isDeadSession(404, notFound), true);
    assert.equal(isDeadSession(400, 'Bad Request: Missing session ID'), true);
    assert.equal(isDeadSession(400, 'Request must be an initialize request if no session ID is provided.'), true);
    assert.equal(isDeadSession(404, 'unknown session'), true);
    assert.equal(isDeadSession(400, 'session identifier is required'), true);
  });

  it('rejects a session-shaped payload error', () => {
    assert.equal(isDeadSession(400, 'Unknown tool: session_summary'), false);
    assert.equal(isDeadSession(400, 'sessionId must be a string'), false);
    assert.equal(isDeadSession(400, 'argument session is invalid: expected object'), false);
  });

  it('reads the error message, not the whole payload', () => {
    // A valid error whose *data* mentions a session must not qualify.
    const withData = JSON.stringify({ error: { message: 'Invalid argument', data: { field: 'sessionId', hint: 'session not found' } } });
    assert.equal(isDeadSession(400, withData), false);
    // A tool named after a session must not qualify.
    const unknownTool = JSON.stringify({ error: { message: 'Unknown tool: session_list' } });
    assert.equal(isDeadSession(400, unknownTool), false);
  });

  it('rejects every other status', () => {
    assert.equal(isDeadSession(401, 'invalid_token'), false);
    assert.equal(isDeadSession(403, 'insufficient_scope'), false);
    assert.equal(isDeadSession(500, 'Session not found'), false);
    assert.equal(isDeadSession(200, 'Session'), false);
  });
});
