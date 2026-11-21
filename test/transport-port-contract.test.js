/**
 * HTTP transport port contract.
 *
 * The transport is exercised against a stubbed port set with no plugin state.
 * Every collaborator it needs is injected, and a stubbed port is the only way
 * it can reach the outside world.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHttpTransport, isDeadSession, parseSseMessages } from '../lib/transport/http.js';

const NL = String.fromCharCode(10);
const SERVER = { id: 'srv-1', name: 'database', type: 'http', authMode: 'oauth', url: 'https://mcp.test/mcp' };

/** A port set that records every call and never reaches the network by itself. */
function ports(overrides = {}) {
  const seen = [];
  const record = (name) => (server) => { seen.push({ name, server }); };
  return {
    seen,
    authHeadersFor: () => ({ Authorization: 'Bearer test' }),
    refreshToken: async () => false,
    ensureFreshToken: async () => {},
    onAuthRejection: record('onAuthRejection'),
    onSuccessfulCall: record('onSuccessfulCall'),
    recordAttempt: (server) => { seen.push({ name: 'recordAttempt', server }); },
    redact: (text) => String(text ?? ''),
    discoverMetadata: async () => null,
    baseScopeOf: () => ({ scope: '', source: 'none' }),
    persistOauthCache: async () => {},
    replug: null,
    resolveTimeout: () => 5000,
    log: { info() {}, warn() {} },
    ...overrides,
  };
}

describe('transport port contract', () => {
  it('builds with no ports at all', () => {
    const transport = createHttpTransport();
    assert.equal(typeof transport.openHttp, 'function');
    assert.equal(typeof transport.openSse, 'function');
    assert.equal(typeof transport.mcpRpc, 'function');
    assert.equal(typeof transport.listAllTools, 'function');
  });

  it('exposes the wire helpers the host calls for OAuth', () => {
    const transport = createHttpTransport(ports());
    for (const name of ['captureResourceMetadata', 'insufficientScopeError', 'serverReason', 'parseRpc', 'logProtocolVersion']) {
      assert.equal(typeof transport[name], 'function', name + ' is exposed');
    }
  });

  it('reads the server wording out of a rejection through the redactor', () => {
    const hits = [];
    const transport = createHttpTransport(ports({
      redact: (text) => { hits.push(text); return 'REDACTED'; },
    }));
    const body = JSON.stringify({ error: 'invalid_token' });
    assert.equal(transport.serverReason({ text: body }), 'REDACTED');
    assert.deepEqual(hits, ['invalid_token']);
  });

  it('pages through a tool listing until the cursors end', async () => {
    const transport = createHttpTransport(ports());
    const pages = [
      { tools: [{ name: 'a' }, { name: 'b' }], nextCursor: 'c2' },
      { tools: [{ name: 'c' }] },
    ];
    let call = 0;
    const handle = { listTools: async () => pages[call++] };
    const listed = await transport.listAllTools(handle);
    assert.deepEqual(listed.map((entry) => entry.name), ['a', 'b', 'c']);
  });

  it('rejects a repeated cursor instead of looping forever', async () => {
    const transport = createHttpTransport(ports());
    const handle = { listTools: async () => ({ tools: [], nextCursor: 'same' }) };
    await assert.rejects(() => transport.listAllTools(handle), /repeated cursor/);
  });

  it('parses an SSE response body into messages', () => {
    const body = 'event: message' + NL + 'data: ' + JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + NL + NL;
    assert.equal(parseSseMessages(body).length, 1);
  });
});

describe('dead session recognition', () => {
  const body = (value) => JSON.stringify(value);

  it('accepts the shapes servers actually produce', () => {
    assert.equal(isDeadSession(404, body({ error: { code: -32600, message: 'Session not found' } })), true);
    assert.equal(isDeadSession(400, 'Bad Request: Missing session ID'), true);
    assert.equal(isDeadSession(400, 'Request must be an initialize request if no session ID is provided.'), true);
  });

  it('rejects everything that is not about a session', () => {
    assert.equal(isDeadSession(401, 'invalid_token'), false);
    assert.equal(isDeadSession(403, 'insufficient_scope'), false);
    assert.equal(isDeadSession(500, 'session'), false);
    assert.equal(isDeadSession(400, 'invalid payload'), false);
    assert.equal(isDeadSession(200, 'Session'), false);
  });
});
describe('required ports are actually used', () => {
  it('openHttp fails when the credential port is missing', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 200, headers: new Map(), text: async () => '{}' });
    const transport = createHttpTransport({});
    try {
      await assert.rejects(() => transport.openHttp(SERVER), /authHeadersFor is not a function/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('openHttp succeeds once the credential port is supplied', async () => {
    const originalFetch = globalThis.fetch;
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'stub' } } });
    const bodies = [payload, JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [] } })];
    let call = 0;
    globalThis.fetch = async () => ({
      status: 200,
      headers: { get: () => null },
      text: async () => bodies[Math.min(call++, bodies.length - 1)],
    });
    const transport = createHttpTransport(ports());
    try {
      const handle = await transport.openHttp(SERVER);
      assert.deepEqual(handle.tools, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
