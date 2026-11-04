import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, it } from 'node:test';

// STATE_PATH is derived from homedir() at module evaluation: HOME on POSIX,
// USERPROFILE on Windows. Pin both before importing; DSH_HOME alone is not enough.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-mm-oauth-'));
process.env.HOME = scratchHome;
process.env.USERPROFILE = scratchHome;
process.env.DSH_HOME = join(scratchHome, '.dsh');
after(() => rmSync(scratchHome, { recursive: true, force: true }));

// Fail before loading the plugin if isolation regresses (issue #16). Check the
// Windows variable even on POSIX so every platform catches a missing assignment.
assert.equal(process.env.USERPROFILE, scratchHome, 'USERPROFILE must use the scratch home');
assert.equal(homedir(), scratchHome, 'homedir() must resolve to the scratch home');
mkdirSync(join(scratchHome, '.dsh'), { recursive: true });
const statePath = join(scratchHome, '.dsh', 'mcp-manager.json');

const { apply } = await import('../lib/index.js');
const { deliverCallback, redirectOf } = await import('./helpers/oauth-harness.js');

/** Minimal ctx: enough for apply() to mount its route without a real harness. */
const testDisposers = [];
afterEach(() => { for (const dispose of testDisposers.splice(0).reverse()) dispose(); });

function makeCtx(config = {}) {
  const routes = [];
  const cleanup = [];
  const effect = (fn) => { const dispose = fn(); if (typeof dispose === 'function') cleanup.push(dispose); return () => {}; };
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: { guard: () => () => {}, register: () => () => {}, restrict: () => () => {}, execute: async () => ({}) },
    webServer: { register: (route) => { routes.push(route); return () => {}; } },
    get: () => undefined,
    on: () => () => {},
    inject: (names, callback) => {
      if (typeof callback === 'function' && names.includes('webServer')) {
        callback({ webServer: ctx.webServer, get: () => undefined, effect });
      }
      return { dispose: () => {} };
    },
    effect,
  };
  apply(ctx, config);
  const dispose = () => { for (const fn of cleanup.splice(0).reverse()) fn(); };
  testDisposers.push(dispose);
  return { routes, handler: routes[0]?.handler, dispose };
}

/** Call the mounted route with a minimal req/res pair; returns the raw body too. */
async function request(handler, method, path, body, headers = {}) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = {
    method,
    url: path,
    headers: { host: '127.0.0.1:3080', ...headers },
    async *[Symbol.asyncIterator]() { for (const chunk of payload) yield chunk; },
  };
  const res = {
    code: 0,
    body: '',
    writeHead(code) { this.code = code; },
    end(chunk) { this.body = chunk ?? ''; },
  };
  await handler(req, res);
  let json;
  try { json = res.body ? JSON.parse(res.body) : undefined; } catch {}
  return { code: res.code, json, text: String(res.body) };
}

/**
 * One dependency-free server playing both roles from the GitHub MCP topology:
 * the MCP endpoint 401s with a resource_metadata pointer, the protected-resource
 * document names a *path-carrying* authorization server, and the AS metadata is
 * only served at the RFC 8414 path-inserted URL. It records every request so a
 * test can prove which URLs were probed.
 */
function startStub({ advertiseRegistration = false, tokenBody = null, requiredApplicationType = '' } = {}) {
  const seen = [];
  const forms = [];
  const registrations = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      seen.push(req.method + ' ' + req.url);
      const send = (code, body, headers = {}) => {
        res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
      };
      const base = `http://127.0.0.1:${server.address().port}`;

      if (req.url === '/mcp') {
        if (requiredApplicationType && req.headers.authorization === 'Bearer example-access-token') {
          const message = JSON.parse(raw || '{}');
          if (message.id === undefined) return send(202, '');
          const result = message.method === 'initialize'
            ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'strict-oauth', version: '1' } }
            : message.method === 'tools/list' ? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } : {};
          return send(200, { jsonrpc: '2.0', id: message.id, result });
        }
        return send(401, { error: 'unauthorized' }, {
          'WWW-Authenticate': `Bearer error="invalid_request", error_description="No access token was provided in this request", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        });
      }
      if (req.url === '/.well-known/oauth-protected-resource/mcp') {
        return send(200, { resource: `${base}/mcp`, authorization_servers: [`${base}/login/oauth`] });
      }
      if (req.url === '/.well-known/oauth-protected-resource') return send(404, { error: 'not found' });
      if (req.url === '/.well-known/oauth-authorization-server/login/oauth') {
        const md = {
          issuer: `${base}/login/oauth`,
          authorization_endpoint: `${base}/login/oauth/authorize`,
          token_endpoint: `${base}/login/oauth/access_token`,
          code_challenge_methods_supported: ['S256'],
        };
        if (advertiseRegistration) md.registration_endpoint = `${base}/register`;
        return send(200, md);
      }
      if (req.url === '/.well-known/oauth-authorization-server') return send(404, { error: 'not found' });
      if (req.url === '/register') {
        if (!advertiseRegistration) return send(404, '404 page not found');
        let payload = {};
        try { payload = JSON.parse(raw || '{}'); } catch {}
        registrations.push(payload);
        if (!Array.isArray(payload.redirect_uris) || payload.redirect_uris.length === 0) return send(400, { error: 'invalid_client_metadata' });
        if (requiredApplicationType && payload.application_type !== requiredApplicationType) {
          return send(400, { error: 'invalid_client_metadata', error_description: `application_type must be ${requiredApplicationType}` });
        }
        return send(201, { client_id: 'dcr-client', redirect_uris: payload.redirect_uris });
      }
      if (req.url === '/login/oauth/access_token') {
        forms.push(new URLSearchParams(raw));
        if (tokenBody) return send(400, tokenBody);
        return send(200, { access_token: 'example-access-token', refresh_token: 'example-refresh-token', token_type: 'bearer', expires_in: 3600 });
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
        seen,
        forms,
        registrations,
        async close() {
          server.closeAllConnections?.();
          await new Promise((done) => server.close(done));
        },
      });
    });
  });
}

const state = () => JSON.parse(readFileSync(statePath, 'utf8'));

// SEP-837: a strict OIDC registration endpoint distinguishes locally hosted
// clients from remote web clients. These are synthetic Host headers only;
// every network request goes to the loopback stub, never to these hostnames.
// SEP-837: the callback is always a loopback listener now, so a registration is
// always a native client. The Host header of the request that starts the flow
// has no say in it any more.
it('issue #21: registers the loopback callback as a native client', async (t) => {
  const stub = await startStub({ advertiseRegistration: true, requiredApplicationType: 'native' });
  t.after(() => stub.close());
  const { handler } = makeCtx();
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', { name: 'type-native', type: 'http', url: stub.mcpUrl });
  assert.equal(created.code, 201, created.text);
  const id = created.json.server.id;
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(auth.code, 200, auth.text);
  assert.equal(stub.registrations.length, 1);
  assert.equal(stub.registrations[0].application_type, 'native');
  assert.deepEqual(stub.registrations[0].redirect_uris, [redirectOf(auth.json.authorizeUrl)]);
  assert.match(redirectOf(auth.json.authorizeUrl), /^http:\/\/localhost:\d+\/callback$/);
  assert.equal(new URL(auth.json.authorizeUrl).searchParams.get('client_id'), 'dcr-client');
});

it('issue #21: strict native registration completes PKCE, connects, and reuses only the same redirect', async (t) => {
  const stub = await startStub({ advertiseRegistration: true, requiredApplicationType: 'native' });
  const { handler } = makeCtx();
  let id;
  t.after(async () => {
    if (id) await request(handler, 'DELETE', `/mcp-manager/api/servers/${id}`);
    await stub.close();
  });
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', { name: 'native-roundtrip', type: 'http', url: stub.mcpUrl });
  assert.equal(created.code, 201, created.text);
  id = created.json.server.id;
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(auth.code, 200, auth.text);
  const authorize = new URL(auth.json.authorizeUrl);
  const redirect = redirectOf(auth.json.authorizeUrl);
  assert.match(redirect, /^http:\/\/localhost:\d+\/callback$/);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(stub.registrations[0].token_endpoint_auth_method, 'none');
  assert.match(stub.registrations[0].client_name, /^dsh-mcp-manager-/);
  const invalid = await deliverCallback(auth.json.authorizeUrl, { state: 'wrong' });
  assert.match(invalid.text, /does not match any pending authorization/);
  assert.equal(stub.forms.length, 0, 'an invalid state must never exchange a code');
  const callback = await deliverCallback(auth.json.authorizeUrl);
  assert.match(callback.text, /Authorized/);
  assert.equal(stub.forms.length, 1);
  assert.equal(stub.forms[0].get('redirect_uri'), redirect);
  assert.equal(stub.forms[0].get('client_id'), 'dcr-client');
  assert.equal(stub.forms[0].get('client_secret'), null);
  assert.equal(createHash('sha256').update(stub.forms[0].get('code_verifier')).digest('base64url'), authorize.searchParams.get('code_challenge'));
  const view = await request(handler, 'GET', '/mcp-manager/api/servers');
  const connected = view.json.servers.find((server) => server.id === id);
  assert.equal(connected.status, 'connected');
  assert.equal(connected.toolCount, 1);
  assert.equal(state().servers.find((server) => server.id === id).oauth.clientId, 'dcr-client');
  assert.equal(stub.registrations.length, 1, 'the callback reused the registered redirect');
  // Automatic mode allocates a port per authorization, so a second login
  // legitimately registers again for the new URI. A fixed or overridden URI is
  // what keeps the client stable across logins.
  const second = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(second.code, 200, second.text);
  assert.notEqual(redirectOf(second.json.authorizeUrl), redirect);
  assert.equal(stub.registrations.length, 2);
  // A per-server override changes the exact URI, so the client is registered
  // again for it: a registration is bound to one redirect.
  const edited = await request(handler, 'PUT', `/mcp-manager/api/servers/${id}`, {
    name: 'native-roundtrip', type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: '127.0.0.1',
  });
  assert.equal(edited.code, 200, edited.text);
  const changed = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(changed.code, 200, changed.text);
  assert.equal(stub.registrations.length, 3, 'changing the redirect URI requires registration for the new exact redirect');
  assert.match(redirectOf(changed.json.authorizeUrl), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  assert.deepEqual(stub.registrations[2].redirect_uris, [redirectOf(changed.json.authorizeUrl)]);
});

it('issue #21: reports a provider metadata rejection without assuming DCR is unsupported or retrying it', async (t) => {
  // The callback is a native loopback client now, so a provider that only
  // registers web clients is the rejection this covers.
  const stub = await startStub({ advertiseRegistration: true, requiredApplicationType: 'web' });
  t.after(() => stub.close());
  const { handler } = makeCtx();
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', { name: 'rejected-web', type: 'http', url: stub.mcpUrl });
  const id = created.json.server.id;
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(auth.code, 500);
  assert.match(auth.json.error, /HTTP 400.*invalid_client_metadata/);
  assert.ok(!auth.json.error.includes('may not support'));
  assert.equal(stub.registrations.length, 1, 'do not retry with another identity or application type');
  assert.equal(stub.forms.length, 0);
  const logs = await request(handler, 'GET', `/mcp-manager/api/servers/${id}/logs`);
  assert.ok(logs.json.logs.some((entry) => entry.phase === 'register' && entry.status === 400 && entry.detail.includes('invalid_client_metadata')));
});

it('discovers a path-carrying authorization server and honours a manual client id', async () => {
  const stub = await startStub();
  const { handler } = makeCtx();

  const created = await request(handler, 'POST', '/mcp-manager/api/servers', {
    name: 'github', type: 'http', url: stub.mcpUrl, authMode: 'oauth', clientId: 'test-client', scope: 'repo read:org',
  });
  assert.equal(created.code, 201);
  assert.equal(created.json.server.clientId, 'test-client');
  assert.equal(created.json.server.scope, 'repo read:org');

  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${created.json.server.id}/auth`);
  assert.equal(auth.code, 200);
  const authorize = new URL(auth.json.authorizeUrl);
  assert.equal(authorize.origin + authorize.pathname, `${stub.base}/login/oauth/authorize`, 'the RFC 8414 path-inserted AS metadata must win');
  assert.equal(authorize.searchParams.get('client_id'), 'test-client');
  assert.equal(authorize.searchParams.get('scope'), 'repo read:org');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorize.searchParams.get('code_challenge'), 'PKCE challenge must be sent');
  assert.match(redirectOf(auth.json.authorizeUrl), /^http:\/\/localhost:\d+\/callback$/);

  // The chain used the advertised pointer, never guessed an origin-level AS URL,
  // and never attempted dynamic registration for a manually configured client.
  assert.ok(stub.seen.includes('GET /.well-known/oauth-protected-resource/mcp'));
  assert.ok(stub.seen.includes('GET /.well-known/oauth-authorization-server/login/oauth'));
  assert.ok(!stub.seen.includes('GET /.well-known/oauth-authorization-server'), 'the naive origin-level probe must not be needed here');
  assert.ok(!stub.seen.some((entry) => entry.includes('/register')), 'a manual client id must skip RFC 7591 registration');

  const persisted = state().servers.find((s) => s.name === 'github');
  assert.equal(persisted.clientId, 'test-client');
  assert.equal(persisted.oauth.authorizationServer, `${stub.base}/login/oauth`);
  assert.equal(persisted.oauth.resourceMetadataUrl, `${stub.base}/.well-known/oauth-protected-resource/mcp`);

  await stub.close();
});

it('falls back to dynamic client registration when the AS advertises it', async () => {
  const stub = await startStub({ advertiseRegistration: true });
  const { handler } = makeCtx();
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', { name: 'dcr', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  assert.equal(created.code, 201);
  assert.equal(created.json.server.clientId, '');

  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${created.json.server.id}/auth`);
  assert.equal(auth.code, 200, auth.text);
  const authorize = new URL(auth.json.authorizeUrl);
  assert.equal(authorize.searchParams.get('client_id'), 'dcr-client', 'registration must supply the client id');
  assert.ok(stub.seen.includes('POST /register'), 'RFC 7591 registration must be attempted when advertised');
  assert.equal(authorize.searchParams.get('scope'), null, 'no scope is sent unless one is configured');

  await stub.close();
});

it('explains an AS without dynamic registration instead of reporting a bare HTTP 404', async () => {
  const stub = await startStub();
  const { handler } = makeCtx();
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', { name: 'nodcr', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${created.json.server.id}/auth`);
  assert.equal(auth.code, 500);
  assert.match(auth.json.error, /dynamic client registration|Client ID/);
  assert.ok(!/HTTP 404\b/.test(auth.json.error) || /dynamic client registration/.test(auth.json.error));

  const logs = await request(handler, 'GET', `/mcp-manager/api/servers/${created.json.server.id}/logs`);
  assert.equal(logs.code, 200);
  const register = logs.json.logs.find((entry) => entry.phase === 'register');
  assert.ok(register, 'the failed registration must be traced');
  assert.equal(register.status, 404);

  await stub.close();
});

it('sends client_secret only when its environment variable resolves', async () => {
  const stub = await startStub();
  const { handler } = makeCtx();
  process.env.DSH_MM_TEST_SECRET = 'example-secret';
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', {
    name: 'secret', type: 'http', url: stub.mcpUrl, authMode: 'oauth', clientId: 'secret-client', clientSecretEnv: 'DSH_MM_TEST_SECRET',
  });
  const id = created.json.server.id;
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(auth.code, 200);
  const callback = await deliverCallback(auth.json.authorizeUrl);
  const exchanges = stub.forms.filter(form => form.get('grant_type') === 'authorization_code');
  assert.equal(exchanges.length, 1);
  assert.equal(exchanges[0].get('client_secret'), 'example-secret');
  assert.equal(exchanges[0].get('client_id'), 'secret-client');
  assert.equal(exchanges[0].get('code_verifier')?.length > 20, true, 'PKCE verifier must be sent');
  assert.match(callback.text, /Authorized/);
  assert.ok(!callback.text.includes('example-secret'), 'the secret must never reach the browser');

  // A configured-but-unset variable fails by name and never leaks a value.
  const second = await request(handler, 'POST', '/mcp-manager/api/servers', {
    name: 'unset', type: 'http', url: stub.mcpUrl, authMode: 'oauth', clientId: 'c2', clientSecretEnv: 'DSH_MM_MISSING_SECRET',
  });
  const secondId = second.json.server.id;
  const secondAuth = await request(handler, 'POST', `/mcp-manager/api/servers/${secondId}/auth`);
  const failed = await deliverCallback(secondAuth.json.authorizeUrl);
  assert.match(failed.text, /DSH_MM_MISSING_SECRET/);
  delete process.env.DSH_MM_TEST_SECRET;

  await stub.close();
});

it('exposes a redacted attempt log for a failed connection', async (t) => {
  const stub = await startStub({ tokenBody: 'client_secret=SUPERSECRET rejected' });
  // A failing assertion must not leave the stub listening, or the file hangs.
  t.after(() => stub.close());
  const { handler } = makeCtx();
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', { name: 'logger', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  const id = created.json.server.id;

  const connected = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/connect`);
  assert.equal(connected.json.server.status, 'needs-auth');
  // The 401 reason prefers the provider's own wording (upstream behaviour).
  assert.equal(connected.json.server.error, 'HTTP 401: unauthorized');

  const logs = await request(handler, 'GET', `/mcp-manager/api/servers/${id}/logs`);
  assert.equal(logs.code, 200);
  assert.ok(Array.isArray(logs.json.logs) && logs.json.logs.length > 0, 'a failed connect must leave a trace');
  const init = logs.json.logs.find((entry) => entry.phase === 'initialize');
  assert.ok(init, 'the failed initialize must be logged');
  assert.equal(init.url, stub.mcpUrl);
  assert.ok(logs.json.logs.every((entry) => typeof entry.at === 'number' && typeof entry.phase === 'string'));

  // The 401 pointer is cached, so the next authorize reuses it.
  const persisted = state().servers.find((s) => s.name === 'logger');
  assert.equal(persisted.oauth.resourceMetadataUrl, `${stub.base}/.well-known/oauth-protected-resource/mcp`);

  const serialized = JSON.stringify(logs.json.logs);
  assert.ok(!serialized.includes('SUPERSECRET'), 'secrets echoed by a provider must be redacted');
  assert.ok(!/Bearer\s+[A-Za-z0-9]/.test(serialized), 'bearer values must never be stored');
  assert.ok(!serialized.includes('client_secret=top'), 'secret-bearing query values must be redacted');

  // Unknown ids 404 like every other id-addressed route.
  const missing = await request(handler, 'GET', '/mcp-manager/api/servers/does-not-exist/logs');
  assert.equal(missing.code, 404);
});

it('records the stderr tail of a stdio process that exits immediately', async () => {
  const { handler } = makeCtx();
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', {
    name: 'boom', type: 'stdio', command: process.execPath, args: ['-e', "console.error('boom'); process.exit(3)"],
  });
  assert.equal(created.code, 201);
  const id = created.json.server.id;

  const connected = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/connect`);
  assert.equal(connected.json.server.status, 'error');
  assert.match(connected.json.server.error, /boom/);

  const logs = await request(handler, 'GET', `/mcp-manager/api/servers/${id}/logs`);
  const exit = logs.json.logs.find((entry) => entry.phase === 'stdio-exit');
  assert.ok(exit, 'the stdio exit must be logged');
  assert.equal(exit.status, 3);
  assert.match(exit.detail, /boom/);
});

it('drops the manual OAuth fields when the server stops using OAuth', async () => {
  const { handler } = makeCtx();
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', {
    name: 'dropme', type: 'http', url: 'http://127.0.0.1:9317/mcp', authMode: 'oauth', clientId: 'c1', clientSecretEnv: 'SOME_SECRET', scope: 'repo',
  });
  const id = created.json.server.id;
  const updated = await request(handler, 'PUT', `/mcp-manager/api/servers/${id}`, { name: 'dropme', type: 'http', url: 'http://127.0.0.1:9317/mcp', authMode: 'none' });
  assert.equal(updated.code, 200);
  assert.equal(updated.json.server.clientId, '');
  const persisted = state().servers.find((s) => s.name === 'dropme');
  for (const key of ['clientId', 'clientSecretEnv', 'scope', 'oauth']) assert.equal(key in persisted, false, key + ' must be gone');

  const bad = await request(handler, 'POST', '/mcp-manager/api/servers', { name: 'badsecret', type: 'http', url: 'http://127.0.0.1:9317/mcp', authMode: 'oauth', clientSecretEnv: 'not a name!' });
  assert.equal(bad.code, 400);
  assert.match(bad.json.error, /environment variable/);
});
