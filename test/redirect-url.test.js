/**
 * Custom OAuth redirect URL (v0.17.0).
 *
 * The callback origin is derived from the request (loopback IP by default), an
 * operator may override it per server, the value is validated against the
 * loopback/publicOrigins rule, and the URI resolved when a flow starts is
 * replayed verbatim at token exchange. Saving an override must never drop the
 * existing session; the next authentication re-registers the client instead.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, it } from 'node:test';

// STATE_PATH is derived from homedir() at module evaluation: HOME on POSIX,
// USERPROFILE on Windows. Pin both before importing; DSH_HOME alone is not enough.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-mm-redirect-'));
process.env.HOME = scratchHome;
process.env.USERPROFILE = scratchHome;
process.env.DSH_HOME = join(scratchHome, '.dsh');
after(() => rmSync(scratchHome, { recursive: true, force: true }));
assert.equal(homedir(), scratchHome, 'homedir() must resolve to the scratch home');
mkdirSync(join(scratchHome, '.dsh'), { recursive: true });
const statePath = join(scratchHome, '.dsh', 'mcp-manager.json');

const { apply } = await import('../lib/index.js');

/** Minimal ctx: enough for apply() to mount its route without a real harness. */
function makeCtx(config = {}, { workspacePaths = [], agents = null } = {}) {
  let handler;
  const disposers = [];
  const runEffect = (fn) => {
    const dispose = fn();
    if (typeof dispose === 'function') disposers.push(dispose);
    return () => { if (typeof dispose === 'function') dispose(); };
  };
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: { guard: () => () => {}, register: () => () => {}, restrict: () => () => {}, execute: async () => ({}) },
    webServer: { register: (route) => { handler = route.handler; return () => {}; } },
    get: (name) => (name === 'workspaceRegistry' && workspacePaths.length
      ? { list: () => workspacePaths.map((path) => ({ path })) }
      : undefined),
    on: () => () => {},
    inject: (names, callback) => {
      if (typeof callback !== 'function') return { dispose: () => {} };
      if (names.includes('webServer')) callback({ webServer: ctx.webServer, get: () => undefined, effect: runEffect });
      if (names.includes('agents') && agents) callback({ agents, get: () => undefined, effect: runEffect });
      return { dispose: () => {} };
    },
    effect: runEffect,
  };
  apply(ctx, config);
  return {
    handler,
    // Runs the plugin's own teardown: kills stdio children, closes workspace
    // watchers and cancels reconnect timers, so a test that loads a workspace
    // does not leave open handles behind.
    dispose() { for (const fn of disposers.reverse()) { try { fn(); } catch {} } },
  };
}

/** Call the mounted route with a minimal req/res pair; returns the raw body too. */
async function request(handler, method, path, body, headers = {}, socket = undefined) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = {
    method,
    url: path,
    headers: { host: '127.0.0.1:3080', ...headers },
    ...(socket ? { socket } : {}),
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
 * Loopback MCP fixture that doubles as the authorization server: the MCP
 * endpoint 401s with a resource_metadata pointer, the AS advertises RFC 7591
 * registration, and the token endpoint issues an incrementing access token so a
 * reconnect after a stored token succeeds.
 */
function startStub() {
  const forms = [];
  const registrations = [];
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

      if (req.url === '/mcp') {
        const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
        if (bearer.startsWith('access-') && !revoked.has(bearer)) {
          const message = JSON.parse(raw || '{}');
          if (message.id === undefined) return send(202, '');
          const result = message.method === 'initialize'
            ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'redirect-stub', version: '1' } }
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
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          code_challenge_methods_supported: ['S256'],
        });
      }
      if (req.url === '/register') {
        let payload = {};
        try { payload = JSON.parse(raw || '{}'); } catch {}
        registrations.push(payload);
        if (!Array.isArray(payload.redirect_uris) || payload.redirect_uris.length === 0) return send(400, { error: 'invalid_client_metadata' });
        return send(201, { client_id: `dcr-client-${registrations.length}`, redirect_uris: payload.redirect_uris });
      }
      if (req.url === '/token') {
        forms.push(new URLSearchParams(raw));
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
        revoked,
        async close() {
          server.closeAllConnections?.();
          await new Promise((done) => server.close(done));
        },
      });
    });
  });
}

// Minimal agents registry: create() runs the composed setup, which is what
// loads a workspace config into the plugin (and connects its servers).
function makeAgents() {
  return {
    create(options) {
      const agent = {
        id: `agent-${options.cwd}`,
        session: { header: { cwd: options.cwd } },
        ctx: { tools: { register: () => () => {}, restrict: () => () => {}, guard: () => () => {} } },
      };
      const ready = Promise.resolve(options.setup({ effect: () => () => {} }, agent));
      return { agent, ready, dispose() {} };
    },
    resume(options) { return this.create(options); },
  };
}

const state = () => JSON.parse(readFileSync(statePath, 'utf8'));
const stored = (id) => state().servers.find((server) => server.id === id);

/** Create a server, authorise it, and let the stub callback complete the flow. */
async function authenticate(handler, id, headers = {}) {
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`, undefined, headers);
  assert.equal(auth.code, 200, auth.text);
  const authorize = new URL(auth.json.authorizeUrl);
  const callback = await request(handler, 'GET',
    `/mcp-manager/callback/${id}?code=stub-code&state=${authorize.searchParams.get('state')}`, undefined, headers);
  return { authorize, callback };
}

it('derives the default from the request and always names a loopback address', async (t) => {
  const stub = await startStub();
  const { handler } = makeCtx();
  let id;
  t.after(async () => { if (id) await request(handler, 'DELETE', `/mcp-manager/api/servers/${id}`); await stub.close(); });
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', { name: 'default-redirect', type: 'http', url: stub.mcpUrl });
  assert.equal(created.code, 201, created.text);
  id = created.json.server.id;

  // Before any attempt the view already shows the URI the flow will use.
  const view = (await request(handler, 'GET', '/mcp-manager/api/servers')).json.servers.find((s) => s.id === id);
  assert.equal(view.redirectUrl, '');
  assert.equal(view.redirectUri, `http://127.0.0.1:3080/mcp-manager/callback/${id}`);
  assert.equal(view.redirectPending, false);

  const ip = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(new URL(ip.json.authorizeUrl).searchParams.get('redirect_uri'), `http://127.0.0.1:3080/mcp-manager/callback/${id}`);

  // `localhost` in the Host is replaced by the loopback IP; the port is kept.
  const name = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`, undefined, { host: 'localhost:3081' });
  assert.equal(new URL(name.json.authorizeUrl).searchParams.get('redirect_uri'), `http://127.0.0.1:3081/mcp-manager/callback/${id}`);

  // IPv6 loopback stays what the browser used.
  const v6 = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`, undefined, { host: '[::1]:3082' });
  assert.equal(new URL(v6.json.authorizeUrl).searchParams.get('redirect_uri'), `http://[::1]:3082/mcp-manager/callback/${id}`);

  // The last attempt registered the IPv6 redirect, so the view flags the
  // registration as pending while the default now points at 127.0.0.1.
  const after = (await request(handler, 'GET', '/mcp-manager/api/servers')).json.servers.find((s) => s.id === id);
  assert.equal(after.redirectPending, true);
  assert.equal(stored(id).oauth.redirect, `http://[::1]:3082/mcp-manager/callback/${id}`);
});

it('uses a configured public origin verbatim instead of rewriting it', async (t) => {
  const stub = await startStub();
  const { handler } = makeCtx({ publicOrigins: ['https://harness.example.com'] });
  let id;
  t.after(async () => { if (id) await request(handler, 'DELETE', `/mcp-manager/api/servers/${id}`); await stub.close(); });
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', { name: 'public-origin', type: 'http', url: stub.mcpUrl });
  id = created.json.server.id;
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`, undefined, { host: 'localhost:3080' });
  assert.equal(new URL(auth.json.authorizeUrl).searchParams.get('redirect_uri'), `https://harness.example.com/mcp-manager/callback/${id}`);
});

it('inherits the current port for a bare-host override and re-registers when it changes', async (t) => {
  const stub = await startStub();
  const { handler } = makeCtx();
  let id;
  t.after(async () => { if (id) await request(handler, 'DELETE', `/mcp-manager/api/servers/${id}`); await stub.close(); });
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', {
    name: 'bare-host-override', type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: 'localhost',
  });
  assert.equal(created.code, 201, created.text);
  id = created.json.server.id;
  assert.equal(created.json.server.redirectUrl, 'http://localhost');

  const first = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(new URL(first.json.authorizeUrl).searchParams.get('redirect_uri'), `http://localhost:3080/mcp-manager/callback/${id}`);
  assert.deepEqual(stub.registrations[0].redirect_uris, [`http://localhost:3080/mcp-manager/callback/${id}`]);

  // Same override, another GUI port: the inherited port keeps it correct and,
  // because the exact redirect_uri changed, the client is registered again.
  const moved = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`, undefined, { host: '127.0.0.1:4123' });
  assert.equal(new URL(moved.json.authorizeUrl).searchParams.get('redirect_uri'), `http://localhost:4123/mcp-manager/callback/${id}`);
  assert.equal(stub.registrations.length, 2);
  assert.deepEqual(stub.registrations[1].redirect_uris, [`http://localhost:4123/mcp-manager/callback/${id}`]);
});

it('uses an explicit port and scheme verbatim', async (t) => {
  const stub = await startStub();
  const { handler } = makeCtx({ publicOrigins: ['https://relay.example.com'] });
  let id;
  t.after(async () => { if (id) await request(handler, 'DELETE', `/mcp-manager/api/servers/${id}`); await stub.close(); });
  const explicit = await request(handler, 'POST', '/mcp-manager/api/servers', {
    name: 'explicit-port', type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: 'localhost:8080',
  });
  assert.equal(explicit.code, 201, explicit.text);
  id = explicit.json.server.id;
  // The save response carries the same redirect data as GET /servers.
  assert.equal(explicit.json.server.redirectUri, `http://localhost:8080/mcp-manager/callback/${id}`);
  assert.equal(explicit.json.server.redirectDefaultUri, `https://relay.example.com/mcp-manager/callback/${id}`);
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(new URL(auth.json.authorizeUrl).searchParams.get('redirect_uri'), `http://localhost:8080/mcp-manager/callback/${id}`);

  // An allowlisted https origin keeps its scheme and its (default) port.
  const relay = await request(handler, 'PUT', `/mcp-manager/api/servers/${id}`, {
    name: 'explicit-port', type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: 'https://relay.example.com',
  });
  assert.equal(relay.code, 200, relay.text);
  assert.equal(relay.json.server.redirectUrl, 'https://relay.example.com');
  const relayAuth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(new URL(relayAuth.json.authorizeUrl).searchParams.get('redirect_uri'), `https://relay.example.com/mcp-manager/callback/${id}`);
});

it('inherits the local GUI port when a configured public origin names the callback', async (t) => {
  const stub = await startStub();
  const { handler } = makeCtx({ publicOrigins: ['https://harness.example.com'] });
  let id;
  t.after(async () => { if (id) await request(handler, 'DELETE', `/mcp-manager/api/servers/${id}`); await stub.close(); });
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', {
    name: 'public-bare-override', type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: 'localhost',
  });
  assert.equal(created.code, 201, created.text);
  id = created.json.server.id;

  // The public origin has no port; the bare loopback override must inherit the
  // port the browser uses for the GUI, not the public origin's default 443.
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(new URL(auth.json.authorizeUrl).searchParams.get('redirect_uri'), `http://localhost:3080/mcp-manager/callback/${id}`);

  const view = (await request(handler, 'GET', '/mcp-manager/api/servers')).json.servers.find((s) => s.id === id);
  assert.equal(view.redirectUri, `http://localhost:3080/mcp-manager/callback/${id}`);
  // The editor's default is the public origin, i.e. what applies without the override.
  assert.equal(view.redirectDefaultUri, `https://harness.example.com/mcp-manager/callback/${id}`);
});

it('uses the GUI listening port for a loopback override behind a proxy', async (t) => {
  const stub = await startStub();
  const { handler } = makeCtx({ publicOrigins: ['https://harness.example.com'] });
  let id;
  t.after(async () => { if (id) await request(handler, 'DELETE', `/mcp-manager/api/servers/${id}`); await stub.close(); });
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', {
    name: 'proxied-bare-override', type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: 'localhost',
  });
  id = created.json.server.id;

  // The browser reached the GUI through the proxy: the Host is not loopback and
  // the forwarded pair is allowlisted, so only the listening port is local.
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`, undefined,
    { host: 'harness.example.com', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'harness.example.com' },
    { localPort: 49593 });
  assert.equal(new URL(auth.json.authorizeUrl).searchParams.get('redirect_uri'), `http://localhost:49593/mcp-manager/callback/${id}`);
});

it('accepts an allowlisted origin written with its explicit default port', async (t) => {
  const stub = await startStub();
  const { handler } = makeCtx({ publicOrigins: ['https://harness.example.com'] });
  let id;
  t.after(async () => { if (id) await request(handler, 'DELETE', `/mcp-manager/api/servers/${id}`); await stub.close(); });
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', {
    name: 'explicit-default-port', type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: 'https://harness.example.com:443',
  });
  assert.equal(created.code, 201, created.text);
  id = created.json.server.id;
  assert.equal(created.json.server.redirectUrl, 'https://harness.example.com:443');
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(new URL(auth.json.authorizeUrl).searchParams.get('redirect_uri'), `https://harness.example.com:443/mcp-manager/callback/${id}`);
});

it('rejects unusable overrides and keeps the stored value', async (t) => {
  const stub = await startStub();
  const { handler } = makeCtx();
  t.after(() => stub.close());

  const cases = [
    ['https://mcp.example.com', /publicOrigins/],
    ['https://localhost', /plain HTTP/],
    ['http://localhost:3080/mcp-manager/callback/x', /callback path/],
    ['http://user:pass@localhost', /host, host:port or scheme/],
    ['ftp://localhost', /http or https/],
  ];
  for (const [redirectUrl, pattern] of cases) {
    const created = await request(handler, 'POST', '/mcp-manager/api/servers', { name: 'rejected-redirect', type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl });
    assert.equal(created.code, 400, `${redirectUrl} must be rejected`);
    assert.match(created.json.error, pattern);
    assert.equal(state().servers.some((server) => server.name === 'rejected-redirect'), false);
  }

  // The whole 127/8 block is loopback, so an alias address is a valid host.
  const alias = await request(handler, 'POST', '/mcp-manager/api/servers', {
    name: 'loopback-alias', type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: '127.0.0.2:9100',
  });
  assert.equal(alias.code, 201, alias.text);
  t.after(() => request(handler, 'DELETE', `/mcp-manager/api/servers/${alias.json.server.id}`));

  const valid = await request(handler, 'POST', '/mcp-manager/api/servers', {
    name: 'kept-redirect', type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: 'localhost:9000',
  });
  assert.equal(valid.code, 201, valid.text);
  const id = valid.json.server.id;
  t.after(() => request(handler, 'DELETE', `/mcp-manager/api/servers/${id}`));

  const rejected = await request(handler, 'PUT', `/mcp-manager/api/servers/${id}`, {
    name: 'kept-redirect', type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: 'https://mcp.example.com',
  });
  assert.equal(rejected.code, 400, rejected.text);
  assert.equal(stored(id).redirectUrl, 'http://localhost:9000');
});

it('replays the pinned redirect URI at the token exchange', async (t) => {
  const stub = await startStub();
  const { handler } = makeCtx();
  let id;
  t.after(async () => { if (id) await request(handler, 'DELETE', `/mcp-manager/api/servers/${id}`); await stub.close(); });
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', {
    name: 'pinned-redirect', type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: 'localhost',
  });
  id = created.json.server.id;
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  const flowState = new URL(auth.json.authorizeUrl).searchParams.get('state');
  // The callback arrives addressed to a foreign host; the exchange must still
  // send the URI fixed when the flow started, never a re-derived one.
  const callback = await request(handler, 'GET',
    `/mcp-manager/callback/${id}?code=stub-code&state=${flowState}`, undefined, { host: 'remote.example.test' });
  assert.match(callback.text, /Authorized/, callback.text);
  assert.equal(stub.forms.length, 1);
  assert.equal(stub.forms[0].get('redirect_uri'), `http://localhost:3080/mcp-manager/callback/${id}`);
  assert.equal(stored(id).oauth.tokens.access_token, 'access-1');
});

it('keeps the session when the override changes and re-registers on the next authenticate', async (t) => {
  const stub = await startStub();
  const { handler } = makeCtx();
  let id;
  t.after(async () => { if (id) await request(handler, 'DELETE', `/mcp-manager/api/servers/${id}`); await stub.close(); });
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', { name: 'lifecycle-redirect', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  id = created.json.server.id;
  await authenticate(handler, id);
  const settled = (await request(handler, 'GET', '/mcp-manager/api/servers')).json.servers.find((s) => s.id === id);
  assert.equal(settled.redirectPending, false, 'a registration made with the effective URI is not pending');
  const before = stored(id);
  assert.equal(before.oauth.tokens.access_token, 'access-1');
  assert.equal(before.oauth.redirect, `http://127.0.0.1:3080/mcp-manager/callback/${id}`);
  assert.equal(stub.registrations.length, 1);

  const saved = await request(handler, 'PUT', `/mcp-manager/api/servers/${id}`, {
    name: 'lifecycle-redirect', type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: 'localhost',
  });
  assert.equal(saved.code, 200, saved.text);
  // Saving is not authenticating: tokens and the stored registration survive.
  const kept = stored(id);
  assert.equal(kept.oauth.tokens.access_token, 'access-1');
  assert.equal(kept.oauth.redirect, `http://127.0.0.1:3080/mcp-manager/callback/${id}`);

  // The saved session is not just on disk: a revoked access token still
  // refreshes through the old registration, so nobody was signed out.
  stub.revoked.add('access-1');
  const reconnected = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/connect`);
  assert.equal(reconnected.code, 200, reconnected.text);
  assert.equal(stored(id).oauth.tokens.access_token, 'access-2', 'the refresh reused the kept registration');
  assert.equal(stub.registrations.length, 1, 'a save never re-registers');
  const pendingView = (await request(handler, 'GET', '/mcp-manager/api/servers')).json.servers.find((s) => s.id === id);
  assert.equal(pendingView.redirectPending, true);
  assert.equal(pendingView.redirectUri, `http://localhost:3080/mcp-manager/callback/${id}`);

  const reauth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(reauth.code, 200, reauth.text);
  assert.equal(new URL(reauth.json.authorizeUrl).searchParams.get('redirect_uri'), `http://localhost:3080/mcp-manager/callback/${id}`);
  assert.equal(stub.registrations.length, 2, 'a new redirect requires a new registration');
  // The replaced client cannot refresh the old pair, so it is dropped now.
  assert.equal(stored(id).oauth.tokens, undefined);
  assert.equal(stored(id).oauth.redirect, `http://localhost:3080/mcp-manager/callback/${id}`);
});

it('never re-registers a manual client id', async (t) => {
  const stub = await startStub();
  const { handler } = makeCtx();
  let id;
  t.after(async () => { if (id) await request(handler, 'DELETE', `/mcp-manager/api/servers/${id}`); await stub.close(); });
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', {
    name: 'manual-redirect', type: 'http', url: stub.mcpUrl, authMode: 'oauth', clientId: 'manual-client', redirectUrl: 'localhost:7777',
  });
  id = created.json.server.id;
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  const authorize = new URL(auth.json.authorizeUrl);
  assert.equal(authorize.searchParams.get('client_id'), 'manual-client');
  assert.equal(authorize.searchParams.get('redirect_uri'), `http://localhost:7777/mcp-manager/callback/${id}`);
  assert.equal(stub.registrations.length, 0);
});

it('adopts a redirect override hand-edited into the state file', async (t) => {
  const stub = await startStub();
  const { handler } = makeCtx();
  let id;
  t.after(async () => { if (id) await request(handler, 'DELETE', `/mcp-manager/api/servers/${id}`); await stub.close(); });
  const created = await request(handler, 'POST', '/mcp-manager/api/servers', { name: 'external-redirect', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  id = created.json.server.id;

  const disk = state();
  disk.servers.find((server) => server.id === id).redirectUrl = 'localhost:6060';
  writeFileSync(statePath, JSON.stringify(disk, null, 2));
  const auth = await request(handler, 'POST', `/mcp-manager/api/servers/${id}/auth`);
  assert.equal(new URL(auth.json.authorizeUrl).searchParams.get('redirect_uri'), `http://localhost:6060/mcp-manager/callback/${id}`);
});

it('honours, preserves and reloads a workspace entry override', async (t) => {
  const stub = await startStub();
  const workspaceDir = join(scratchHome, 'workspace-with-override');
  mkdirSync(join(workspaceDir, '.dsh', 'dshmm'), { recursive: true });
  const configFile = join(workspaceDir, '.dsh', 'dshmm', 'mcp.json');
  const writeConfig = (value) => writeFileSync(configFile, JSON.stringify(value, null, 2));
  writeConfig({ mcpServers: { wsff: { type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: 'localhost:9999' } } });
  const agents = makeAgents();
  const { handler, dispose } = makeCtx({}, { workspacePaths: [workspaceDir], agents });
  t.after(async () => { dispose(); await stub.close(); });

  const row = (await request(handler, 'GET', '/mcp-manager/api/workspaces')).json.workspaces
    .find((ws) => ws.path === workspaceDir).servers.find((server) => server.name === 'wsff');
  assert.equal(row.redirectUrl, 'http://localhost:9999');
  assert.equal(row.redirectUri, `http://localhost:9999/mcp-manager/callback/${row.id}`);

  // An edit that omits the field keeps it, like the other OAuth fields.
  const edited = await request(handler, 'PUT', '/mcp-manager/api/workspaces/servers', {
    path: workspaceDir, oldName: 'wsff', name: 'wsff', type: 'http', url: stub.mcpUrl, authMode: 'oauth',
  });
  assert.equal(edited.code, 200, edited.text);
  assert.equal(JSON.parse(readFileSync(configFile, 'utf8')).mcpServers.wsff.redirectUrl, 'http://localhost:9999');

  // A hand-edited value is picked up on the next read.
  writeConfig({ mcpServers: { wsff: { type: 'http', url: stub.mcpUrl, authMode: 'oauth', redirectUrl: 'localhost:7070' } } });
  const reloaded = (await request(handler, 'GET', '/mcp-manager/api/workspaces')).json.workspaces
    .find((ws) => ws.path === workspaceDir).servers.find((server) => server.name === 'wsff');
  assert.equal(reloaded.redirectUri, `http://localhost:7070/mcp-manager/callback/${reloaded.id}`);

  // Load the workspace and run its authorization: the entry's override is what
  // the flow presents.
  const { ready } = agents.create({ cwd: workspaceDir });
  await ready;
  const auth = await request(handler, 'POST', '/mcp-manager/api/workspaces/auth', { path: workspaceDir, name: 'wsff' });
  assert.equal(auth.code, 200, auth.text);
  assert.equal(new URL(auth.json.authorizeUrl).searchParams.get('redirect_uri'), `http://localhost:7070/mcp-manager/callback/${reloaded.id}`);
});
