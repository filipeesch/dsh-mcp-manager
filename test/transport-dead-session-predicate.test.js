/**
 * The dead-session predicate must separate a transport session from request data.
 *
 * The measured positives are short protocol statements. Everything else that
 * merely mentions a session — a tool name, a field name, a hint in `data` — is
 * about the request and must not trigger a reconnect and a replay.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isDeadSession } from '../lib/transport/http.js';

/** Wrap a message in the JSON-RPC error envelope a server actually sends. */
function rpcError(message, code = -32602) {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code, message } });
}

describe('isDeadSession', () => {
  it('accepts the measured transport-session statements', () => {
    assert.equal(isDeadSession(404, rpcError('Session not found', -32600)), true);
    assert.equal(isDeadSession(400, 'Bad Request: Missing session ID'), true);
    assert.equal(isDeadSession(400, 'Request must be an initialize request if no session ID is provided.'), true);
    assert.equal(isDeadSession(400, rpcError('Session expired')), true);
    assert.equal(isDeadSession(404, rpcError('Unknown session')), true);
    assert.equal(isDeadSession(400, rpcError('Invalid session ID')), true);
  });

  it('rejects a request-shaped error that mentions a session', () => {
    // A field or tool whose name contains `session` says nothing about the transport.
    assert.equal(isDeadSession(400, rpcError('Invalid payload: missing session_name')), false);
    assert.equal(isDeadSession(400, rpcError('unknown session_count field')), false);
    assert.equal(isDeadSession(400, rpcError('Missing session ID in tool arguments')), false);
    assert.equal(isDeadSession(400, rpcError('Unknown tool: session_list')), false);
    assert.equal(isDeadSession(400, rpcError('sessionId must be a string')), false);
    assert.equal(isDeadSession(400, rpcError('Argument sessionId is required')), false);
  });

  it('never searches a hint inside the error data', () => {
    const withHint = JSON.stringify({ jsonrpc: '2.0', error: { code: -32602, message: 'Invalid argument', data: { hint: 'session not found' } } });
    assert.equal(isDeadSession(400, withHint), false);
  });

  it('ignores every status that is not a 400 or 404', () => {
    assert.equal(isDeadSession(401, 'invalid_token'), false);
    assert.equal(isDeadSession(403, 'insufficient_scope'), false);
    assert.equal(isDeadSession(500, 'Session not found'), false);
    assert.equal(isDeadSession(200, 'Session'), false);
  });
});
