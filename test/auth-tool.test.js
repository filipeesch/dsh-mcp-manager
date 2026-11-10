/**
 * mcp_authenticate_server: the model-facing authorization request.
 *
 * The definition is unit-tested through its injected ports, and the plugin wiring
 * is exercised over a loopback MCP + authorization server so the real OAuth flow
 * starts, the notice reaches the model once, and registration follows the set of
 * browser-authorizable servers.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, it } from 'node:test';
import { createAuthTool } from '../lib/tools/auth-tool.js';

const scratch = mkdtempSync(join(tmpdir(), 'dsh-mm-auth-tool-'));
process.env.HOME = scratch;
process.env.USERPROFILE = scratch;
process.env.DSH_HOME = join(scratch, '.dsh');
mkdirSync(process.env.DSH_HOME, { recursive: true });
const statePath = join(process.env.DSH_HOME, 'mcp-manager.json');

const URL_UNDER_TEST = 'http://127.0.0.1:4321/authorize?state=abc';
const OAUTH = { name: 'atlas', type: 'http', authMode: 'oauth' };

function harness(overrides = {}) {
  const calls = { started: [], opened: [] };
  const definition = createAuthTool({
    resolveServer: (name) => {
      if (overrides.resolve) return overrides.resolve(name);
      if (name === OAUTH.name) return overrides.server ?? OAUTH;
      return null;
    },
    isDisabled: (server) => server.enabled === false,
    canAuthorize: (server) => (server.type ?? 'http') !== 'stdio' && server.authMode === 'oauth',
    pendingUrl: () => overrides.pending ?? null,
    startAuthorization: async (server) => { calls.started.push(server.name); return URL_UNDER_TEST; },
    openUrl: async (url) => { calls.opened.push(url); return overrides.open ?? { opened: true }; },
  });
  return { definition, calls };
}

const run = (definition, args, exec = {}) => definition.execute(args ?? {}, exec);

it('declares one required server argument', () => {
  const { definition } = harness();
  assert.equal(definition.name, 'mcp_authenticate_server');
  assert.deepEqual(definition.parameters.required, ['server']);
  assert.equal(definition.parameters.additionalProperties, false);
  assert.equal(definition.isConcurrencySafe(), false);
});

it('starts the flow and opens the browser', async () => {
  const { definition, calls } = harness();
  const result = await run(definition, { server: 'atlas' });
  assert.deepEqual(calls.started, ['atlas']);
  assert.deepEqual(calls.opened, [URL_UNDER_TEST]);
  assert.match(result.text, /Authorization started for "atlas"/);
  assert.match(result.text, /call the tool you wanted again/);
  assert.ok(result.text.includes(URL_UNDER_TEST), 'the URL travels with the result even when a browser opened');
});

it('returns the URL when no browser was opened', async () => {
  const { definition } = harness({ open: { opened: false, reason: 'remote' } });
  const result = await run(definition, { server: 'atlas' });
  assert.match(result.text, new RegExp(URL_UNDER_TEST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

it('reuses a pending flow instead of starting another', async () => {
  const { definition, calls } = harness({ pending: URL_UNDER_TEST });
  const result = await run(definition, { server: 'atlas' });
  assert.deepEqual(calls.started, []);
  assert.deepEqual(calls.opened, []);
  assert.match(result.text, /already in progress/);
  assert.ok(result.text.includes(URL_UNDER_TEST), 'a running flow hands its URL back');
});

it('refuses an unknown server', async () => {
  const { definition, calls } = harness();
  await assert.rejects(run(definition, { server: 'nope' }), /No MCP server named "nope" is configured/);
  assert.deepEqual(calls.started, []);
});

it('refuses a missing name', async () => {
  const { definition } = harness();
  await assert.rejects(run(definition, {}), /requires the name/);
});

it('refuses a disabled server without starting a flow', async () => {
  const { definition, calls } = harness({ server: { ...OAUTH, enabled: false } });
  await assert.rejects(run(definition, { server: 'atlas' }), /is disabled/);
  assert.deepEqual(calls.started, []);
});

it('refuses a server without a browser flow', async () => {
  const { definition, calls } = harness({ server: { name: 'atlas', type: 'http', authMode: 'static' } });
  await assert.rejects(run(definition, { server: 'atlas' }), /cannot be authorized through the browser/);
  assert.deepEqual(calls.started, []);

  const stdio = harness({ server: { name: 'atlas', type: 'stdio' } });
  await assert.rejects(run(stdio.definition, { server: 'atlas' }), /cannot be authorized through the browser/);
  assert.deepEqual(stdio.calls.started, []);
});

// ---- plugin wiring ----

const mod = await import('../lib/index.js');
const { mountPlugin } = await import('./helpers/plugin-harness.js');
const { deliverCallback, startAuthorizationStub, waitFor } = await import('./helpers/oauth-harness.js');

after(() => rmSync(scratch, { recursive: true, force: true }));

function mount(t, options = {}) {
  writeFileSync(statePath, JSON.stringify({ servers: [] }));
  const app = mountPlugin(mod, options);
  t.after(() => app.dispose());
  return app;
}

// No test may open a real browser: the SSH marker makes the opener return the
// URL instead of launching anything.
function sshMode(t) {
  const previous = process.env.SSH_CONNECTION;
  process.env.SSH_CONNECTION = '127.0.0.1 5555 127.0.0.1 22';
  t.after(() => {
    if (previous === undefined) delete process.env.SSH_CONNECTION;
    else process.env.SSH_CONNECTION = previous;
  });
}

it('is registered only while a browser-authorizable server exists', async (t) => {
  const app = mount(t);
  assert.equal(app.tool('mcp_authenticate_server'), undefined);

  const staticServer = await app.request('POST', '/servers', { name: 'bearer', type: 'http', url: 'http://127.0.0.1:9/mcp', authMode: 'static', tokenEnv: 'MM_MISSING_TOKEN' });
  assert.equal(staticServer.status, 201, JSON.stringify(staticServer));
  assert.equal(app.tool('mcp_authenticate_server'), undefined);

  const oauthServer = await app.request('POST', '/servers', { name: 'atlas', type: 'http', url: 'http://127.0.0.1:9/mcp', authMode: 'oauth' });
  assert.equal(oauthServer.status, 201, JSON.stringify(oauthServer));
  const definition = app.tool('mcp_authenticate_server');
  assert.ok(definition, 'the tool must exist once an OAuth server is configured');
  // The broker defers direct mcp__ tools; this one is not an MCP tool and stays callable.
  assert.equal(definition.deferLoading, undefined);

  const removed = await app.request('DELETE', `/servers/${oauthServer.server.id}`);
  assert.equal(removed.status, 200, JSON.stringify(removed));
  assert.equal(app.tool('mcp_authenticate_server'), undefined);
});

it('reports an unknown server without starting a flow', async (t) => {
  const app = mount(t);
  const created = await app.request('POST', '/servers', { name: 'atlas', type: 'http', url: 'http://127.0.0.1:9/mcp', authMode: 'oauth' });
  assert.equal(created.status, 201, JSON.stringify(created));
  await assert.rejects(app.tool('mcp_authenticate_server').execute({ server: 'other' }, {}), /No MCP server named "other"/);
});

it('starts a real authorization and announces it to the model once', { timeout: 20000 }, async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const contexts = [];
  const app = mount(t, { systemPrompt: { context: (entry) => { contexts.push(entry); return () => {}; } } });
  const created = await app.request('POST', '/servers', { name: 'atlas', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  assert.equal(created.status, 201, JSON.stringify(created));

  // The host is reached over SSH in the test: no browser may be launched.
  const previousSsh = process.env.SSH_CONNECTION;
  process.env.SSH_CONNECTION = '127.0.0.1 5555 127.0.0.1 22';
  t.after(() => {
    if (previousSsh === undefined) delete process.env.SSH_CONNECTION;
    else process.env.SSH_CONNECTION = previousSsh;
  });

  const result = await app.tool('mcp_authenticate_server').execute({ server: 'atlas' }, {});
  assert.match(result.text, /Authorization started for "atlas"/);
  const authorizeUrl = result.text.match(/https?:\/\/\S+/)?.[0];
  assert.ok(authorizeUrl, `the result must carry the URL: ${result.text}`);

  assert.match((await deliverCallback(authorizeUrl)).text, /Authorized/);
  await waitFor(() => app.tool('mcp__atlas__echo') !== undefined, 'the server reconnects');

  assert.equal(contexts.length, 1, 'one notice provider is registered');
  assert.match(contexts[0].text({}), /MCP server "atlas" is authenticated/);
});

it('reuses the URL of a flow the Settings action started', { timeout: 20000 }, async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const app = mount(t);
  const created = await app.request('POST', '/servers', { name: 'atlas', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  assert.equal(created.status, 201, JSON.stringify(created));

  const previousSsh = process.env.SSH_CONNECTION;
  process.env.SSH_CONNECTION = '127.0.0.1 5555 127.0.0.1 22';
  t.after(() => {
    if (previousSsh === undefined) delete process.env.SSH_CONNECTION;
    else process.env.SSH_CONNECTION = previousSsh;
  });

  const started = await app.request('POST', `/servers/${created.server.id}/auth`);
  assert.equal(started.status, 200, JSON.stringify(started));

  const result = await app.tool('mcp_authenticate_server').execute({ server: 'atlas' }, {});
  assert.match(result.text, /already in progress/);
  assert.ok(result.text.includes(started.authorizeUrl), 'the running flow URL is handed back, not replaced');
});

it('shares one flow between concurrent calls', { timeout: 20000 }, async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const app = mount(t);
  const created = await app.request('POST', '/servers', { name: 'atlas', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  assert.equal(created.status, 201, JSON.stringify(created));
  sshMode(t);

  const [first, second] = await Promise.all([
    app.tool('mcp_authenticate_server').execute({ server: 'atlas' }, {}),
    app.tool('mcp_authenticate_server').execute({ server: 'atlas' }, {}),
  ]);
  const urls = [first.text, second.text].map((text) => text.match(/https?:\/\/\S+/)?.[0]).filter(Boolean);
  assert.equal(urls.length, 2, 'both calls carry a URL');
  assert.equal(new Set(urls).size, 1, 'both calls share the same authorization flow');
});

it('refuses a global server disabled inside the caller workspace', { timeout: 20000 }, async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const dir = join(scratch, 'ws-disabled');
  mkdirSync(join(dir, '.dsh', 'dshmm'), { recursive: true });
  writeFileSync(join(dir, '.dsh', 'dshmm', 'mcp.json'), JSON.stringify({ disabled: ['atlas'] }));
  const app = mount(t, { workspacePaths: [dir] });
  const created = await app.request('POST', '/servers', { name: 'atlas', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  assert.equal(created.status, 201, JSON.stringify(created));
  const record = await app.createAgent(dir);

  await assert.rejects(
    app.tool('mcp_authenticate_server').execute({ server: 'atlas' }, { agent: record.agent }),
    /is disabled/,
  );
});

it('resolves a conflicting workspace declaration to the global server', { timeout: 20000 }, async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const dir = join(scratch, 'ws-conflict');
  mkdirSync(join(dir, '.dsh', 'dshmm'), { recursive: true });
  writeFileSync(join(dir, '.dsh', 'dshmm', 'mcp.json'), JSON.stringify({
    mcpServers: { atlas: { type: 'http', url: 'http://127.0.0.1:9/mcp', authMode: 'static', tokenEnv: 'MM_UNSET' } },
  }));
  const app = mount(t, { workspacePaths: [dir] });
  const created = await app.request('POST', '/servers', { name: 'atlas', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  assert.equal(created.status, 201, JSON.stringify(created));
  sshMode(t);
  const record = await app.createAgent(dir);

  // The workspace declaration is masked by the same-named global server, so the
  // tool must authorize the global one instead of refusing the static row.
  const result = await app.tool('mcp_authenticate_server').execute({ server: 'atlas' }, { agent: record.agent });
  assert.match(result.text, /Authorization started for "atlas"/);
});

it('keeps the notice through the admission refresh and retires it at the next step', { timeout: 20000 }, async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const contexts = [];
  const app = mount(t, { systemPrompt: { context: (entry) => { contexts.push(entry); return () => {}; } } });
  const created = await app.request('POST', '/servers', { name: 'atlas', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  assert.equal(created.status, 201, JSON.stringify(created));
  sshMode(t);

  const result = await app.tool('mcp_authenticate_server').execute({ server: 'atlas' }, {});
  const authorizeUrl = result.text.match(/https?:\/\/\S+/)?.[0];
  assert.ok(authorizeUrl);
  assert.match((await deliverCallback(authorizeUrl)).text, /Authorized/);
  await waitFor(() => app.tool('mcp__atlas__echo') !== undefined, 'the server reconnects');

  const provider = contexts[0];
  const agent = { id: 'session-notice', session: { header: { cwd: '' } } };

  // The authorization completed while a tool call was running; the step that
  // follows it is the one that carries the notice.
  const step = async () => app.waterfall('agent/pre-step', { agent, turn: 1, step: 1 }, async () => ({ kind: 'enter' }));
  assert.deepEqual(await step(), { kind: 'enter' }, 'the waterfall decision must survive the listener');
  // DSH assembles the prompt and then re-evaluates every context provider for
  // request admission: the notice must survive both reads of the same step.
  assert.match(provider.text({ agent }), /MCP server "atlas" is authenticated/);
  assert.match(provider.text({ agent }), /MCP server "atlas" is authenticated/);

  // The next step begins: the notice is no longer current.
  assert.deepEqual(await step(), { kind: 'enter' });
  assert.equal(provider.text({ agent }), '');
});

it('queues no notice when the authorization does not complete', { timeout: 20000 }, async (t) => {
  const stub = await startAuthorizationStub({ failToken: true });
  t.after(() => stub.close());
  const contexts = [];
  const app = mount(t, { systemPrompt: { context: (entry) => { contexts.push(entry); return () => {}; } } });
  const created = await app.request('POST', '/servers', { name: 'atlas', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  assert.equal(created.status, 201, JSON.stringify(created));
  sshMode(t);

  const result = await app.tool('mcp_authenticate_server').execute({ server: 'atlas' }, {});
  const authorizeUrl = result.text.match(/https?:\/\/\S+/)?.[0];
  assert.ok(authorizeUrl);
  const page = await deliverCallback(authorizeUrl);
  assert.match(page.text, /failed|error/i);
  assert.equal(contexts.length, 0, 'no notice provider is registered for a failed authorization');
});

it('authorizes the caller workspace server and refuses another workspace', { timeout: 20000 }, async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const wsA = join(scratch, 'ws-a-scope');
  const wsB = join(scratch, 'ws-b-scope');
  for (const dir of [wsA, wsB]) mkdirSync(join(dir, '.dsh', 'dshmm'), { recursive: true });
  writeFileSync(join(wsA, '.dsh', 'dshmm', 'mcp.json'), JSON.stringify({
    mcpServers: { local: { type: 'http', url: stub.mcpUrl, authMode: 'oauth' } },
  }));
  writeFileSync(join(wsB, '.dsh', 'dshmm', 'mcp.json'), JSON.stringify({ mcpServers: {} }));
  const app = mount(t, { workspacePaths: [wsA, wsB] });
  sshMode(t);

  const agentA = await app.createAgent(wsA);
  const started = await app.tool('mcp_authenticate_server').execute({ server: 'local' }, { agent: agentA.agent });
  assert.match(started.text, /Authorization started for "local"/);

  const agentB = await app.createAgent(wsB);
  await assert.rejects(
    app.tool('mcp_authenticate_server').execute({ server: 'local' }, { agent: agentB.agent }),
    /No MCP server named "local"/,
  );
});

it('discards the old catalog when a workspace server is renamed', { timeout: 20000 }, async (t) => {
  const dir = join(scratch, 'ws-rename');
  mkdirSync(join(dir, '.dsh', 'dshmm'), { recursive: true });
  writeFileSync(join(dir, '.dsh', 'dshmm', 'mcp.json'), JSON.stringify({
    mcpServers: { old: { type: 'http', url: 'http://127.0.0.1:9/mcp', authMode: 'oauth' } },
  }));
  const app = mount(t, { workspacePaths: [dir] });
  const key = `ws:${realpathSync(dir)}\u0000old`;
  writeFileSync(join(scratch, '.dsh', 'mcp-manager-tools.json'), JSON.stringify({
    version: 1,
    servers: { [key]: { name: 'old', listedAt: 1, tools: [{ name: 'gone', description: 'gone' }] } },
  }));

  const renamed = await app.request('PUT', '/workspaces/servers', {
    path: dir, oldName: 'old', name: 'new', type: 'http', url: 'http://127.0.0.1:9/mcp', authMode: 'oauth',
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed));
  const document = JSON.parse(readFileSync(join(scratch, '.dsh', 'mcp-manager-tools.json'), 'utf8'));
  assert.equal(Object.hasOwn(document.servers, key), false, 'the old name catalog is gone');
});

it('drops the notice when the host exposes no system prompt', { timeout: 20000 }, async (t) => {
  const stub = await startAuthorizationStub();
  t.after(() => stub.close());
  const app = mount(t);
  const created = await app.request('POST', '/servers', { name: 'atlas', type: 'http', url: stub.mcpUrl, authMode: 'oauth' });
  assert.equal(created.status, 201, JSON.stringify(created));

  const previousSsh = process.env.SSH_CONNECTION;
  process.env.SSH_CONNECTION = '127.0.0.1 5555 127.0.0.1 22';
  t.after(() => {
    if (previousSsh === undefined) delete process.env.SSH_CONNECTION;
    else process.env.SSH_CONNECTION = previousSsh;
  });

  const result = await app.tool('mcp_authenticate_server').execute({ server: 'atlas' }, {});
  const authorizeUrl = result.text.match(/https?:\/\/\S+/)?.[0];
  assert.ok(authorizeUrl);
  assert.match((await deliverCallback(authorizeUrl)).text, /Authorized/);
  await waitFor(() => app.tool('mcp__atlas__echo') !== undefined, 'the server reconnects');

  const dropped = app.warnings.filter((line) => line.includes('not announced'));
  assert.equal(dropped.length, 1, 'the missing channel is reported once');
});