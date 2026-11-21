/**
 * Transport regressions the extraction must not introduce.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
const transport = readFileSync(new URL('../lib/transport/http.js', import.meta.url), 'utf8');

it('defaults a row without a type to HTTP, not stdio', () => {
  const httpDefault = source.includes("(server.type ?? 'http') === 'stdio'");
  const stdioDefault = source.includes("(server.type ?? 'stdio') === 'stdio'");
  assert.equal(httpDefault, true, 'openServer defaults to HTTP');
  assert.equal(stdioDefault, false, 'no row silently becomes stdio');
});

it('refreshes the token proactively on the ordinary RPC path', () => {
  assert.match(transport, /if \(repair\) await ensureFreshToken\(server\);/, 'mcpRpc refreshes before the first attempt');
});

it('does not repair during either connection handshake', () => {
  // The Streamable HTTP handshake calls mcpRpc directly, with repair disabled.
  const mcpHandshake = transport.indexOf("mcpRpc(server, 'notifications/initialized'");
  assert.ok(mcpHandshake > 0, 'the Streamable HTTP handshake exists');
  assert.match(transport.slice(mcpHandshake, mcpHandshake + 200), /repair: false/);
  // The SSE handshake builds its call table with repair disabled.
  const sseHandshake = transport.indexOf('sseSessionCall(server, handle, session.endpointUrl, waiters');
  assert.ok(sseHandshake > 0, 'the SSE handshake exists');
  assert.match(transport.slice(sseHandshake, sseHandshake + 200), /repair: false/);
});

it('uses the shared dead-session predicate from both transport paths', () => {
  const uses = transport.split('isDeadSession(').length - 1;
  assert.ok(uses >= 3, 'defined once and used by the RPC and SSE paths, got ' + uses);
});
