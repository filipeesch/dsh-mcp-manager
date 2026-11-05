/**
 * Shared helpers for the OAuth callback suites.
 *
 * The callback is no longer a route on the DSH webserver: it is a real request
 * to a loopback listener the plugin opened, so these helpers read the redirect
 * URI out of the authorization URL and drive it over HTTP.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

/** The redirect URI the authorization request pinned for this flow. */
export function redirectOf(authorizeUrl) {
  const redirect = new URL(String(authorizeUrl)).searchParams.get('redirect_uri');
  assert.ok(redirect, 'the authorization URL must carry a redirect_uri');
  return redirect;
}

/** The OAuth state that identifies this flow. */
export function stateOf(authorizeUrl) {
  const state = new URL(String(authorizeUrl)).searchParams.get('state');
  assert.ok(state, 'the authorization URL must carry a state');
  return state;
}

/**
 * Deliver a callback the way a browser would: a GET to the pinned redirect
 * URI. `state` defaults to the flow's own state, `code` to `stub-code`.
 */
export async function deliverCallback(authorizeUrl, params = {}) {
  const url = new URL(redirectOf(authorizeUrl));
  url.searchParams.set('state', 'state' in params ? String(params.state ?? '') : stateOf(authorizeUrl));
  if ('code' in params) {
    if (params.code !== null && params.code !== undefined) url.searchParams.set('code', String(params.code));
  } else {
    url.searchParams.set('code', 'stub-code');
  }
  if (params.error) url.searchParams.set('error', String(params.error));
  const response = await fetch(url, { redirect: 'manual' });
  return { response, status: response.status, text: await response.text(), url: url.toString() };
}

/** Poll until `predicate` is truthy, or fail with `message`. */
export async function waitFor(predicate, message = 'condition not met', { timeoutMs = 5000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Whether a TCP port is currently bindable (i.e. the listener released it). */
export async function canBindPort(port) {
  const { createServer } = await import('node:http');
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port: Number(port) }, () => {
      server.close(() => resolve(true));
    });
  });
}

/** Find a currently free loopback TCP port (bind, read, release). */
export async function freePort() {
  const { createServer } = await import('node:http');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Whether this machine can bind the IPv6 loopback (some CI images cannot). */
export async function canBindIPv6Loopback() {
  const { createServer } = await import('node:http');
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '::1', port: 0 }, () => server.close(() => resolve(true)));
  });
}

/**
 * Loopback fixture that plays both roles: the MCP endpoint 401s with a
 * protected-resource pointer, and the authorization server advertises RFC 7591
 * registration and a token endpoint. Records every registration and form.
 */
export async function startAuthorizationStub({ failToken = false, failRefresh = false, scopeChallenge = false, confidential = false, sse = false, authorizationEndpoint = '' } = {}) {
  const forms = [];
  const registrations = [];
  const toolCalls = [];
  /** sessionId -> SSE response stream, for the legacy HTTP-with-SSE mode. */
  const sseSessions = new Map();
  /** client_id -> client_secret issued by a confidential registration */
  const clientSecrets = new Map();
  const revoked = new Set();
  let issued = 0;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const send = (code, body, headers = {}) => {
        res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
      };
      const base = `http://127.0.0.1:${server.address().port}`;
      const requestUrl = new URL(req.url, base);
      if (sse && requestUrl.pathname === '/mcp' && req.method === 'GET') {
        const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
        if (!(bearer.startsWith('access-') && !revoked.has(bearer))) {
          return send(401, { error: 'unauthorized' }, {
            'WWW-Authenticate': `Bearer error="invalid_request", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
          });
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const sessionId = randomUUID();
        sseSessions.set(sessionId, res);
        res.write(`event: endpoint\ndata: ?sessionId=${sessionId}\n\n`);
        res.on('close', () => sseSessions.delete(sessionId));
        return;
      }
      if (sse && requestUrl.pathname === '/mcp' && req.method === 'POST') {
        const sessionId = requestUrl.searchParams.get('sessionId');
        if (!sessionId) return send(400, 'sessionId query parameter is not provided', { 'Content-Type': 'text/plain; charset=UTF-8' });
        const stream = sseSessions.get(sessionId);
        if (!stream) return send(404, 'unknown session', { 'Content-Type': 'text/plain; charset=UTF-8' });
        const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
        if (!(bearer.startsWith('access-') && !revoked.has(bearer))) {
          return send(401, { error: 'unauthorized' }, {
            'WWW-Authenticate': `Bearer error="invalid_request", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
          });
        }
        const message = JSON.parse(raw || '{}');
        if (message.id === undefined) return send(202, '');
        if (scopeChallenge && message.method === 'tools/call') {
          return send(403, { error: 'insufficient_scope' }, {
            'WWW-Authenticate': `Bearer error="insufficient_scope", scope="feed:read", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
          });
        }
        if (message.method === 'tools/call') toolCalls.push({ name: message.params?.name, arguments: message.params?.arguments });
        const result = message.method === 'initialize'
          ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'oauth-stub', version: '1' } }
          : message.method === 'tools/list' ? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } : {};
        stream.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`);
        return send(202, '');
      }
      if (req.url === '/mcp') {
        const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
        if (bearer.startsWith('access-') && !revoked.has(bearer)) {
          const message = JSON.parse(raw || '{}');
          if (message.id === undefined) return send(202, '');
          if (scopeChallenge && message.method === 'tools/call') {
            return send(403, { error: 'insufficient_scope' }, {
              'WWW-Authenticate': `Bearer error="insufficient_scope", scope="feed:read", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
            });
          }
          if (message.method === 'tools/call') toolCalls.push({ name: message.params?.name, arguments: message.params?.arguments });
          const result = message.method === 'initialize'
            ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'oauth-stub', version: '1' } }
            : message.method === 'tools/list' ? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } : {};
          return send(200, { jsonrpc: '2.0', id: message.id, result });
        }
        return send(401, { error: 'unauthorized' }, {
          'WWW-Authenticate': `Bearer error="invalid_request", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        });
      }
      if (req.url === '/.well-known/oauth-protected-resource/mcp') {
        return send(200, { resource: `${base}/mcp`, authorization_servers: [base] });
      }
      if (req.url === '/.well-known/oauth-protected-resource') return send(404, { error: 'not found' });
      if (req.url === '/.well-known/oauth-authorization-server') {
        return send(200, {
          issuer: base,
          authorization_endpoint: authorizationEndpoint || `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          code_challenge_methods_supported: ['S256'],
          ...(confidential ? { token_endpoint_auth_methods_supported: ['client_secret_post'] } : {}),
        });
      }
      if (req.url === '/register') {
        let payload = {};
        try { payload = JSON.parse(raw || '{}'); } catch {}
        registrations.push(payload);
        if (!Array.isArray(payload.redirect_uris) || payload.redirect_uris.length === 0) {
          return send(400, { error: 'invalid_client_metadata' });
        }
        const clientId = `dcr-client-${registrations.length}`;
        if (confidential && payload.token_endpoint_auth_method === 'client_secret_post') {
          const secret = `dcr-secret-${registrations.length}`;
          clientSecrets.set(clientId, secret);
          return send(201, { client_id: clientId, client_secret: secret, redirect_uris: payload.redirect_uris });
        }
        return send(201, { client_id: clientId, redirect_uris: payload.redirect_uris });
      }
      if (req.url === '/token') {
        const form = new URLSearchParams(raw);
        forms.push(form);
        // A revoked token that a refresh cannot repair is what parks a tool call.
        if (failRefresh && form.get('grant_type') === 'refresh_token') {
          return send(400, { error: 'invalid_grant', error_description: 'refresh token revoked' });
        }
        // A confidential client must present the secret issued by its own
        // registration: mixing two clients' id and secret is rejected here, the
        // way a strict authorization server would reject it.
        const expectedSecret = clientSecrets.get(form.get('client_id') ?? '');
        if (expectedSecret && form.get('client_secret') !== expectedSecret) {
          return send(400, { error: 'invalid_client', error_description: 'client_secret does not match the registered client' });
        }
        if (!expectedSecret && form.get('client_secret')) {
          return send(400, { error: 'invalid_client', error_description: 'unexpected client_secret' });
        }
        if (failToken) return send(400, { error: 'invalid_grant', error_description: 'code expired' });
        issued += 1;
        return send(200, { access_token: `access-${issued}`, refresh_token: `refresh-${issued}`, token_type: 'bearer', expires_in: 3600 });
      }
      return send(404, { error: 'not found' });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({
        base,
        mcpUrl: `${base}/mcp`,
        forms,
        registrations,
        toolCalls,
        revoked,
        async close() {
          server.closeAllConnections?.();
          await new Promise((done) => server.close(done));
        },
      });
    });
  });
}
