/**
 * The client half's single interface language, plus the Settings → MCP rendering
 * contract it shares with the other client suites.
 *
 * The plugin ships one language: every string comes from its own English table,
 * and the page never asks the host for a language or registers a locale
 * namespace.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import {
  clientSource as source,
  mountClient as mount,
  response,
  settle,
  nodes,
  text,
  content,
} from './helpers/client-harness.js';


it('seats the settings section with the plugin own translator and no locale dependency', () => {
  const app = mount(async () => response({}));
  assert.equal(app.spec.name, 'settings.section');
  assert.equal(app.spec.locale, undefined, 'the plugin no longer registers a locale namespace');
  assert.equal(app.spec.label(), 'MCP');
  assert.deepEqual([...app.inject], ['slots']);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(!pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'), 'the client no longer depends on the locale bundle');
  assert.match(source, /const inject = \["slots"\];/);
  assert.doesNotMatch(source, /\p{Script=Han}/u);
  assert.doesNotMatch(source, /STRINGS|translator|systemLanguage|navigator|settings\/language|mm_language/);
  app.dispose();
});

it('renders every string from the plugin table and never asks the host for a language', async () => {
  const calls = [];
  const app = mount(async (url) => { calls.push(url); return response({}); });
  let tree = app.render();
  assert.match(text(tree), /MCP servers/);
  app.effects(); await settle();
  tree = app.render();
  assert.equal(calls.filter((url) => url.endsWith('/settings')).length, 1);
  assert.ok(calls.every((url) => !url.includes('/settings/language')), 'the page never requests a language');
});

it('explains the full-catalog Code/PTC fallback', () => {
  const app = mount(async () => response({}));
  assert.match(text(app.render()), /Code\/PTC\/both keeps the full MCP catalog/);
  app.dispose();
});

it('renders English list, add form, and stdio fields using the same translator', async () => {
  const app = mount(async () => response({}));
  let tree = app.render();
  assert.match(text(tree), /MCP servers/);
  nodes(tree).find((node) => node.props['aria-label'] === 'Add MCP server').props.onClick();
  tree = app.render();
  assert.match(text(tree), /Add MCP server/);
  const form = content(tree);
  app.reset();
  tree = app.render(form.type, form.props);
  assert.match(text(tree), /Authentication method/);
  assert.match(text(tree), /Headers from environment variables/);
  nodes(tree).find((node) => node.type === 'select' && node.props.value === 'http').props.onChange({ target: { value: 'stdio' } });
  tree = app.render(form.type, form.props);
  assert.match(text(tree), /Command \(executable\)/);
  assert.match(text(tree), /Environment variables/);
});

it('offers a no-auth HTTP mode and hides the token field when selected', async () => {
  const app = mount(async () => response({}));
  let tree = app.render();
  nodes(tree).find((node) => node.props['aria-label'] === 'Add MCP server').props.onClick();
  tree = app.render();
  const form = content(tree);
  app.reset();
  tree = app.render(form.type, form.props);

  const authSelect = nodes(tree).find((node) => node.type === 'select' && node.props.value === 'oauth');
  assert.ok(authSelect, 'the authentication-method select renders');
  assert.deepEqual(authSelect.children.map((option) => option.props.value), ['oauth', 'static', 'none']);
  assert.match(text(tree), /No auth \(server needs no credentials\)/);
  assert.doesNotMatch(text(tree), /Bearer token environment variable/);

  // Static still asks for the env var name...
  authSelect.props.onChange({ target: { value: 'static' } });
  tree = app.render(form.type, form.props);
  assert.match(text(tree), /Bearer token environment variable/);

  // ...while no-auth hides the credential field entirely.
  nodes(tree).find((node) => node.type === 'select' && node.props.value === 'static').props.onChange({ target: { value: 'none' } });
  tree = app.render(form.type, form.props);
  assert.match(text(tree), /No auth \(server needs no credentials\)/);
  assert.doesNotMatch(text(tree), /Bearer token environment variable/);
});

it('collects manual OAuth client credentials only while OAuth is selected', async () => {
  const app = mount(async () => response({}));
  let tree = app.render();
  nodes(tree).find((node) => node.props['aria-label'] === 'Add MCP server').props.onClick();
  tree = app.render();
  const form = content(tree);
  app.reset();
  tree = app.render(form.type, form.props);

  assert.match(text(tree), /OAuth Client ID/);
  assert.match(text(tree), /Client secret environment variable name/);
  assert.match(text(tree), /OAuth client name/);
  assert.match(text(tree), /Scopes \(optional/);
  const inputs = nodes(tree).filter((node) => node.type === 'input');
  const clientIdInput = inputs.find((node) => node.props.placeholder === 'Ov23li…');
  const secretInput = inputs.find((node) => node.props.placeholder === 'GITHUB_OAUTH_CLIENT_SECRET');
  const clientNameInput = inputs.find((node) => node.props.placeholder === 'dsh-mcp-manager-my-server');
  const scopeInput = inputs.find((node) => node.props.placeholder === 'repo read:org');
  assert.ok(clientIdInput && secretInput && clientNameInput && scopeInput, 'all four OAuth fields render');
  clientIdInput.props.onChange({ target: { value: 'my-client' } });
  secretInput.props.onChange({ target: { value: 'MY_SECRET_ENV' } });
  clientNameInput.props.onChange({ target: { value: 'acme-dcr-client' } });
  scopeInput.props.onChange({ target: { value: 'repo' } });
  tree = app.render(form.type, form.props);
  assert.equal(nodes(tree).find((node) => node.props.placeholder === 'dsh-mcp-manager-my-server').props.value, 'acme-dcr-client');

  // Switching to a non-OAuth mode hides them again.
  nodes(tree).find((node) => node.type === 'select' && node.props.value === 'oauth').props.onChange({ target: { value: 'none' } });
  tree = app.render(form.type, form.props);
  assert.doesNotMatch(text(tree), /OAuth Client ID/);
  assert.doesNotMatch(text(tree), /Client secret environment variable name/);
  assert.doesNotMatch(text(tree), /OAuth client name/);
});

it('edits and clears tool-call timeouts for both transports and scopes', async () => {
  for (const scope of ['user', 'workspace']) {
    for (const type of ['http', 'stdio']) {
      const calls = [];
      const app = mount(async (url, options) => { calls.push({ url, options }); return response({}); });
      let tree = app.render();
      nodes(tree).find(node => node.props['aria-label'] === 'Add MCP server').props.onClick();
      const form = content(app.render());
      app.reset();
      const props = { ...form.props, scope, workspacePath: '/workspace', initial: { id: 'test', name: 'test', type, timeout: 600000 } };
      tree = app.render(form.type, props);
      const input = nodes(tree).find(node => node.props.type === 'number');
      assert.equal(input.props.value, 600000);
      assert.equal(input.props.min, 1000);
      assert.equal(input.props.step, 1000);
      assert.match(text(tree), /Tool-call timeout \(ms, optional\)/);
      for (const value of ['120000', '']) {
        input.props.onChange({ target: { value } });
        tree = app.render(form.type, props);
        await nodes(tree).find(node => node.type === 'button' && text(node) === 'Save').props.onClick();
        const submitted = calls.findLast(call => call.options.method === 'PUT');
        assert.equal(JSON.parse(submitted.options.body).timeout, value);
        assert.ok(submitted.url.endsWith(scope === 'workspace' ? '/workspaces/servers' : '/servers/test'));
      }
    }
  }
});

it('shows a collapsed connection error and lazily loads the attempt log', async () => {
  const calls = [];
  const server = { id: 'srv-1', name: 'github', type: 'http', url: 'https://api.githubcopilot.com/mcp/', authMode: 'oauth', status: 'error', error: 'client registration failed: HTTP 404 — this authorization server may not support dynamic client registration', toolCount: 0, enabled: true };
  const app = mount(async (url) => {
    calls.push(url);
    if (url.endsWith('/servers')) return response({ servers: [server] });
    if (url.endsWith('/workspaces')) return response({ workspaces: [] });
    if (url.endsWith('/settings')) return response({ onDemandToolInjection: false });
    if (url.endsWith('/servers/srv-1/logs')) return response({ logs: [{ at: 1700000000000, phase: 'discovery', url: 'https://github.com/.well-known/oauth-authorization-server/login/oauth', status: 200, detail: 'authorization server metadata' }] });
    return response({});
  });
  let tree = app.render();
  app.effects(); await settle();
  tree = app.render();

  const cardNode = (t) => nodes(t).find((node) => node.props?.server?.id === 'srv-1');
  const renderCard = (node) => { app.reset(); return app.render(node.type, node.props); };

  // The reason is visible without expanding the card...
  const collapsed = renderCard(cardNode(tree));
  assert.match(text(collapsed), /may not support dynamic client registration/);
  assert.doesNotMatch(text(collapsed), /Logs/, 'the log toggle lives in the expanded card');
  assert.ok(!calls.some((url) => url.endsWith('/logs')), 'logs must not be fetched until requested');

  // ...and expanding the card reveals the log toggle in the action row.
  let card = renderCard({ type: cardNode(tree).type, props: { ...cardNode(tree).props, open: true } });
  assert.match(text(card), /may not support dynamic client registration/, 'the reason stays visible while expanded');
  const toggleEl = nodes(card).find((node) => typeof node.type === 'function' && node.props?.log);
  assert.ok(toggleEl, 'the log toggle sits in the action row');
  const toggleAt = nodes(card).indexOf(toggleEl);
  const editAt = nodes(card).findIndex((node) => node.type === 'button' && text(node) === 'Edit');
  assert.ok(toggleAt >= 0 && toggleAt < editAt, 'Logs sits next to Edit');
  assert.doesNotMatch(text(card), /No log entries yet/, 'the log body is hidden until toggled');
  assert.ok(!calls.some((url) => url.endsWith('/logs')), 'opening the card alone must not fetch the log');

  // Toggling fetches on demand and renders the panel below the action row.
  const toggle = app.render(toggleEl.type, toggleEl.props);
  toggle.props.onClick();
  await settle();
  await settle();
  card = app.render(cardNode(tree).type, { ...cardNode(tree).props, open: true });
  assert.ok(calls.some((url) => url.endsWith('/servers/srv-1/logs')), 'the toggle must fetch the log');
  const panelEl = nodes(card).find((node) => typeof node.type === 'function' && node.type.name === 'AttemptLogPanel');
  assert.ok(panelEl, 'the log panel renders below the action row');
  const panel = app.render(panelEl.type, panelEl.props);
  assert.match(text(panel), /authorization server metadata/);
  const panelAt = nodes(card).indexOf(panelEl);
  const actionsAt = nodes(card).findIndex((node) => node.props?.className === 'mm_cardActions');
  assert.ok(panelAt > actionsAt, 'the log panel renders after the action row');
});

it('shows the insufficient-scope message and a scoped re-auth button', async () => {
  const globalServer = {
    id: 'srv-scope', name: 'trypost', type: 'http', url: 'https://post.mrbean.dev/mcp/trypost',
    authMode: 'oauth', status: 'needs-auth', toolCount: 0, enabled: true,
    error: 'insufficient scope (requires: mcp:use): re-authenticate to grant access',
    oauth: { insufficientScope: { scope: 'mcp:use' } },
  };
  const workspaceServer = {
    id: 'ws-scope', name: 'ws-trypost', type: 'http', url: 'https://post.mrbean.dev/mcp/ws',
    authMode: 'oauth', status: 'needs-auth', toolCount: 0,
    error: 'insufficient scope (requires: posts:write): re-authenticate to grant access',
    insufficientScope: { scope: 'posts:write' },
  };
  const app = mount(async (url) => {
    if (url.endsWith('/servers')) return response({ servers: [globalServer] });
    if (url.endsWith('/workspaces')) return response({ workspaces: [{ path: '/ws', servers: [workspaceServer], exclude: [], error: '' }] });
    if (url.endsWith('/settings')) return response({ onDemandToolInjection: false });
    return response({});
  });
  let tree = app.render();
  app.effects(); await settle();
  tree = app.render();

  const globalNode = nodes(tree).find((node) => node.props?.server?.id === 'srv-scope');
  assert.ok(globalNode, 'the governed server row renders');
  // Expanding the card is where the re-auth action lives.
  const expanded = { type: globalNode.type, props: { ...globalNode.props, open: true } };
  // The workspace row only exists after selecting its workspace.
  nodes(tree).find((node) => node.props?.className === 'mm_wsSelect').props.onChange({ target: { value: '/ws' } });
  tree = app.render();
  const workspaceNode = nodes(tree).find((node) => node.props?.server?.id === 'ws-scope');
  assert.ok(workspaceNode, 'the workspace server row renders');

  const authChip = (rendered) => nodes(rendered).find((node) => node.type === 'button' && String(node.props.className).includes('mm_badge auth'));
  const renderRow = (node) => { app.reset(); return app.render(node.type, node.props); };

  // The global row carries oauth.insufficientScope; the raw host error is
  // replaced by the localized message and the scoped re-auth button.
  let row = renderRow(expanded);
  assert.match(text(row), /Insufficient scope: the token lacks the required scope \(mcp:use\)\./);
  assert.doesNotMatch(text(row), /insufficient scope \(requires:/, 'the raw host error is not duplicated');
  assert.equal(authChip(row).props['aria-label'], 'Authenticate: trypost', 'the status chip is the auth action');

  // Workspace rows carry the same data top-level and follow the same locale.
  row = renderRow(workspaceNode);

  row = renderRow(expanded);
  assert.match(text(row), /Insufficient scope: the token lacks the required scope \(mcp:use\)\./);
});

it('offers a per-workspace enable switch for global and workspace-local servers', async () => {
  const calls = [];
  const globalServer = { id: 'g1', name: 'github', type: 'http', url: 'https://example.test/mcp', authMode: 'oauth', status: 'connected', enabled: true, toolCount: 3 };
  const localServer = { id: 'w1', name: 'local', type: 'http', url: 'https://local.test/mcp', authMode: 'none', status: 'disabled', disabled: true, toolCount: 0 };
  const workspaces = [{ path: '/ws', servers: [localServer], exclude: [], disabled: ['github'], error: '' }];
  const app = mount(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/servers')) return response({ servers: [globalServer] });
    if (url.endsWith('/workspaces')) return response({ workspaces });
    if (url.endsWith('/workspaces/server-state')) return response({ workspaces });
    if (url.endsWith('/settings')) return response({ onDemandToolInjection: false });
    return response({});
  });
  let tree = app.render();
  app.effects(); await settle();
  tree = app.render();
  nodes(tree).find((node) => node.props?.className === 'mm_wsSelect').props.onChange({ target: { value: '/ws' } });
  tree = app.render();

  const localNode = nodes(tree).find((node) => node.props?.server?.id === 'w1');
  const globalNode = nodes(tree).find((node) => node.props?.server?.id === 'g1');
  assert.ok(localNode && globalNode, 'both rows render in the workspace view');
  const renderRow = (node, props = {}) => { app.reset(); return app.render(node.type, { ...node.props, ...props }); };
  const workspaceSwitch = (rendered, name) => nodes(rendered).find((node) => node.type === 'button'
    && node.props?.className === 'mm_switch' && node.props['aria-label'] === `Enabled in this workspace: ${name}`);

  // A workspace card starts collapsed like the global one: no actions until the
  // header is opened.
  const collapsedRow = renderRow(localNode, { open: false });
  assert.ok(!nodes(collapsedRow).some((node) => node.type === 'button' && text(node) === 'Edit'),
    'a workspace card starts collapsed');

  // A disabled workspace-local server still renders its row, dimmed, with the
  // switch label reporting the state; the switch re-enables it.
  let row = renderRow(localNode, { open: true });
  assert.match(text(row), /Disabled/);
  const rowLabels = nodes(row).filter((node) => node.type === 'button').map(text);
  assert.ok(rowLabels.includes('Edit') && rowLabels.includes('Delete'), 'workspace rows expose direct actions');
  const localSwitch = workspaceSwitch(row, 'local');
  assert.equal(localSwitch.props['data-on'], undefined, 'the switch is off');
  assert.equal(localSwitch.props['aria-checked'], false);
  localSwitch.props.onClick();
  await settle();
  const localCall = calls.find((call) => call.url.endsWith('/workspaces/server-state'));
  assert.ok(localCall, 'the switch posts to the workspace server-state endpoint');
  assert.deepEqual(JSON.parse(localCall.options.body), { path: '/ws', name: 'local', enabled: true });

  // A global server listed in the workspace's disabled list renders as off and
  // enabling it writes the same endpoint contract.
  row = renderRow(globalNode);
  const globalSwitch = workspaceSwitch(row, 'github');
  assert.equal(globalSwitch.props['data-on'], undefined, 'a disabled global server is off in this workspace');
  globalSwitch.props.onClick();
  await settle();
  const bodies = calls.filter((call) => call.url.endsWith('/workspaces/server-state')).map((call) => JSON.parse(call.options.body));
  assert.ok(bodies.some((body) => body.name === 'github' && body.enabled === true));
  await new Promise((resolve) => setImmediate(resolve));
});

it('makes the needs-auth status chip the authentication action', async () => {
  const calls = [];
  const needsAuth = { id: 'srv-chip', name: 'needs', type: 'http', url: 'https://x.test/mcp', authMode: 'oauth', status: 'needs-auth', error: '', toolCount: 0, enabled: true };
  const connected = { id: 'srv-ok', name: 'ok', type: 'http', url: 'https://x.test/mcp', authMode: 'oauth', status: 'connected', error: '', toolCount: 2, enabled: true };
  const app = mount(async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/servers')) return response({ servers: [needsAuth, connected] });
    if (url.endsWith('/workspaces')) return response({ workspaces: [] });
    if (url.endsWith('/settings')) return response({ onDemandToolInjection: false });
    return response({});
  });
  let tree = app.render();
  app.effects(); await settle();
  tree = app.render();
  const chipRow = nodes(tree).find((node) => node.props?.server?.id === 'srv-chip');
  const okRow = nodes(tree).find((node) => node.props?.server?.id === 'srv-ok');

  app.reset();
  const chipCard = app.render(chipRow.type, chipRow.props);
  const chip = nodes(chipCard).find((node) => node.type === 'button' && String(node.props.className).includes('mm_badge auth'));
  assert.ok(chip, 'the needs-auth badge is a button');
  assert.equal(text(chip), 'Authentication required');
  assert.equal(chip.props['aria-label'], 'Authenticate: needs');
  chip.props.onClick();
  await settle();
  assert.ok(calls.some((call) => call.url.endsWith('/servers/srv-chip/auth')), 'clicking the chip starts the authorization');

  app.reset();
  const okCard = app.render(okRow.type, okRow.props);
  assert.ok(!nodes(okCard).some((node) => node.type === 'button' && String(node.props.className).includes('mm_badge auth')),
    'a connected server has no authentication chip');
});

it('shows the effective redirect URI in the editor, not on the card', async () => {
  const server = {
    id: 'srv-redirect', name: 'figma', type: 'http', url: 'https://mcp.figma.com/mcp',
    authMode: 'oauth', status: 'needs-auth', error: '', toolCount: 0, enabled: true,
    redirectUrl: 'http://localhost',
    redirectUri: 'http://localhost:49593/callback',
    redirectPending: true,
  };
  const app = mount(async (url) => {
    if (url.endsWith('/servers')) return response({ servers: [server] });
    if (url.endsWith('/workspaces')) return response({ workspaces: [] });
    if (url.endsWith('/settings')) return response({ onDemandToolInjection: false });
    return response({});
  });
  let tree = app.render();
  app.effects(); await settle();
  tree = app.render();
  const cardNode = nodes(tree).find((node) => node.props?.server?.id === 'srv-redirect');
  assert.ok(cardNode, 'the server card renders');

  // The editor is where the effective URI, the pending cue and the copy live.
  cardNode.props.onEdit();
  tree = app.render();
  const formEl = content(tree);
  app.reset();
  const form = app.render(formEl.type, formEl.props);
  const detailsEl = nodes(form).find((node) => typeof node.type === 'function' && node.props?.server?.id === 'srv-redirect');
  assert.ok(detailsEl, 'the editor renders the redirect details');
  const details = app.render(detailsEl.type, detailsEl.props);
  assert.match(text(details), /http:\/\/localhost:49593\/callback/);
  assert.match(text(details), /Registration pending/);
  assert.ok(nodes(details).some((node) => typeof node.type === 'function' && node.props?.value === server.redirectUri),
    'the copy action carries the effective URI');

  // The card body no longer repeats the transport endpoint or the redirect URI.
  app.reset();
  const card = app.render(cardNode.type, { ...cardNode.props, open: true });
  assert.doesNotMatch(text(card), /49593\/callback/);
  assert.doesNotMatch(text(card), /OAuth ·/);
});

it('exposes Edit and Delete directly on the expanded card with a confirmation', async () => {
  const server = { id: 'srv-menu', name: 'sentry', type: 'http', url: 'https://mcp.sentry.dev/mcp', authMode: 'oauth', status: 'connected', error: '', toolCount: 2, enabled: true };
  const app = mount(async (url) => {
    if (url.endsWith('/servers')) return response({ servers: [server] });
    if (url.endsWith('/workspaces')) return response({ workspaces: [] });
    if (url.endsWith('/settings')) return response({ onDemandToolInjection: false });
    return response({});
  });
  let tree = app.render();
  app.effects(); await settle();
  tree = app.render();
  const cardNode = nodes(tree).find((node) => node.props?.server?.id === 'srv-menu');

  // The card starts collapsed: its actions appear only when it is opened.
  app.reset();
  const collapsed = app.render(cardNode.type, { ...cardNode.props, open: false });
  const collapsedLabels = nodes(collapsed).filter((node) => node.type === 'button').map(text);
  assert.ok(!collapsedLabels.includes('Edit'), 'a collapsed card shows no actions');
  assert.ok(!collapsedLabels.includes('Delete'));

  let edited = 0;
  app.reset();
  let card = app.render(cardNode.type, { ...cardNode.props, open: true, onEdit: () => { edited += 1; } });
  const labels = nodes(card).filter((node) => node.type === 'button').map(text);
  assert.ok(labels.includes('Edit'), 'Edit is a direct action');
  assert.ok(labels.includes('Delete'), 'Delete is a direct action');
  assert.match(text(card), /Enabled/, 'the switch label reports the state, not the action');
  nodes(card).find((node) => node.type === 'button' && text(node) === 'Edit').props.onClick();
  assert.equal(edited, 1);

  // Delete asks for confirmation instead of deleting immediately.
  app.reset();
  card = app.render(cardNode.type, { ...cardNode.props, open: true });
  nodes(card).find((node) => node.type === 'button' && text(node) === 'Delete').props.onClick();
  card = app.render(cardNode.type, { ...cardNode.props, open: true });
  assert.match(text(card), /Delete \u201csentry\u201d\?/);
  nodes(card).find((node) => node.type === 'button' && text(node) === 'Cancel').props.onClick();
  card = app.render(cardNode.type, { ...cardNode.props, open: true });
  assert.doesNotMatch(text(card), /cannot be undone/);
});

it('copies the effective redirect URI verbatim and shows the copied state', async () => {
  const server = {
    id: 'srv-copy', name: 'figma', type: 'http', url: 'https://mcp.figma.com/mcp', authMode: 'oauth',
    status: 'connected', error: '', toolCount: 1, enabled: true,
    redirectUrl: 'http://localhost',
    redirectUri: 'http://localhost:49593/callback',
    redirectDefaultUri: 'http://127.0.0.1:49593/callback',
  };
  const created = [];
  const commands = [];
  const document = {
    // A non-null style tag keeps the module from injecting one for this test.
    querySelector: () => ({}),
    createElement: () => {
      const area = { style: {}, value: '', select() { this.selected = true; } };
      created.push(area);
      return area;
    },
    body: { appendChild() {}, removeChild() {} },
    execCommand: (command) => { commands.push(command); return true; },
  };
  const app = mount(async (url) => {
    if (url.endsWith('/servers')) return response({ servers: [server] });
    if (url.endsWith('/workspaces')) return response({ workspaces: [] });
    if (url.endsWith('/settings')) return response({ onDemandToolInjection: false });
    return response({});
  }, 'en', { document });
  let tree = app.render();
  app.effects(); await settle();
  tree = app.render();
  const cardNode = nodes(tree).find((node) => node.props?.server?.id === 'srv-copy');
  cardNode.props.onEdit();
  tree = app.render();
  const formEl = content(tree);
  app.reset();
  let form = app.render(formEl.type, formEl.props);
  const detailsEl = nodes(form).find((node) => typeof node.type === 'function' && node.props?.server?.id === 'srv-copy');
  const details = app.render(detailsEl.type, detailsEl.props);
  const copyEl = nodes(details).find((node) => typeof node.type === 'function' && node.props?.value === server.redirectUri);
  assert.ok(copyEl, 'the copy action renders');
  // A fresh hook store: the harness shares one positional array across renders,
  // so the nested component must not inherit a slot from the form above it.
  app.reset();
  let copy = app.render(copyEl.type, copyEl.props);
  nodes(copy).find((node) => node.type === 'button' && text(node) === 'Copy').props.onClick();
  copy = app.render(copyEl.type, copyEl.props);

  assert.equal(commands.length, 1);
  assert.equal(commands[0], 'copy');
  assert.equal(created.length, 1, 'one textarea is used for the copy');
  assert.equal(created[0].value, server.redirectUri, 'the clipboard payload is the effective URI');
  assert.equal(created[0].selected, true, 'the textarea is selected before copying');
  assert.equal(text(nodes(copy).find((node) => node.type === 'button' && node.props.className === 'mm_btn')), 'Copied');
});

it('warns that a manual client id needs the provider allowlist update instead of re-registration', async () => {
  const server = {
    id: 'srv-manual', name: 'github', type: 'http', url: 'https://api.githubcopilot.com/mcp/', authMode: 'oauth',
    status: 'connected', error: '', toolCount: 1, enabled: true,
    clientId: 'Ov23li…', clientSecretEnv: '', clientName: '', scope: '',
    redirectUrl: '', redirectUri: 'http://127.0.0.1:49593/callback',
    redirectDefaultUri: 'http://127.0.0.1:49593/callback',
  };
  const app = mount(async (url) => {
    if (url.endsWith('/servers')) return response({ servers: [server] });
    if (url.endsWith('/workspaces')) return response({ workspaces: [] });
    if (url.endsWith('/settings')) return response({ onDemandToolInjection: false });
    return response({});
  });
  let tree = app.render();
  app.effects(); await settle();
  tree = app.render();
  const cardNode = nodes(tree).find((node) => node.props?.server?.id === 'srv-manual');
  cardNode.props.onEdit();
  tree = app.render();
  const formEl = content(tree);
  app.reset();
  let form = app.render(formEl.type, formEl.props);
  const input = nodes(form).find((node) => node.type === 'input' && node.props.placeholder === 'http://127.0.0.1:49593/callback');
  input.props.onChange({ target: { value: 'localhost:8080' } });
  form = app.render(formEl.type, formEl.props);
  assert.match(text(form), /A manual Client ID is never re-registered/);
  assert.doesNotMatch(text(form), /registers the client again on the next Authenticate/);
});

it('edits the redirect URL against the effective default in the OAuth section', async () => {
  const server = {
    id: 'srv-edit', name: 'figma', type: 'http', url: 'https://mcp.figma.com/mcp', authMode: 'oauth',
    status: 'connected', error: '', toolCount: 1, enabled: true,
    clientId: '', clientSecretEnv: '', clientName: '', scope: '',
    redirectUrl: 'http://localhost', redirectUri: 'http://localhost:49593/callback',
    redirectDefaultUri: 'http://127.0.0.1:49593/callback',
  };
  const app = mount(async (url) => {
    if (url.endsWith('/servers')) return response({ servers: [server] });
    if (url.endsWith('/workspaces')) return response({ workspaces: [] });
    if (url.endsWith('/settings')) return response({ onDemandToolInjection: false });
    return response({});
  });
  let tree = app.render();
  app.effects(); await settle();
  tree = app.render();
  const cardNode = nodes(tree).find((node) => node.props?.server?.id === 'srv-edit');
  cardNode.props.onEdit();
  tree = app.render();
  const formEl = content(tree);
  assert.ok(formEl, 'the edit form renders');
  app.reset();
  let form = app.render(formEl.type, formEl.props);

  const redirectInput = nodes(form).find((node) => node.type === 'input' && node.props.value === 'http://localhost');
  assert.ok(redirectInput, 'the stored override is prefilled');
  // The placeholder is what would apply without the override, so "Use default"
  // shows the address the plugin would really use.
  assert.equal(redirectInput.props.placeholder, 'http://127.0.0.1:49593/callback');
  assert.match(text(form), /Only loopback addresses are accepted/);
  assert.match(text(form), /Use default/);

  // Editing the value announces that the next authentication re-registers.
  redirectInput.props.onChange({ target: { value: 'localhost:8080' } });
  form = app.render(formEl.type, formEl.props);
  assert.match(text(form), /registers the client again on the next Authenticate/);
  assert.equal(nodes(form).find((node) => node.type === 'input' && node.props.value === 'localhost:8080').props.value, 'localhost:8080');

  // "Use default" clears it so the derived default applies again.
  nodes(form).find((node) => node.type === 'button' && text(node) === 'Use default').props.onClick();
  form = app.render(formEl.type, formEl.props);
  assert.equal(nodes(form).find((node) => node.type === 'input' && node.props.placeholder === 'http://127.0.0.1:49593/callback').props.value, '');
  assert.doesNotMatch(text(form), /registers the client again on the next Authenticate/);
});

it('renders the global callback section collapsed with a status line and an error badge', async () => {
  const calls = [];
  const settings = {
    onDemandToolInjection: false,
    oauthCallback: { mode: 'fixed', host: 'localhost', port: 8765, path: '/callback' },
    callbackStatus: {
      listeners: [{ port: 8765, addresses: ['127.0.0.1', '::1'], paths: ['/callback'], pending: 1 }],
      lastError: 'cannot open the OAuth callback listener at 127.0.0.1:8765: port 8765 is already in use',
    },
  };
  let saved = 0;
  const app = mount(async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/servers')) return response({ servers: [] });
    if (url.endsWith('/workspaces')) return response({ workspaces: [] });
    if (url.endsWith('/settings/callback')) return response({ oauthCallback: settings.oauthCallback, callbackStatus: settings.callbackStatus });
    if (url.endsWith('/settings')) return response(settings);
    return response({});
  });
  let tree = app.render();
  app.effects();
  await settle();
  tree = app.render();
  const sectionEl = nodes(tree).find((node) => node.props?.settings && typeof node.props?.onSaved === 'function');
  assert.ok(sectionEl, 'the callback section renders on the page');
  app.reset();
  let section = app.render(sectionEl.type, { ...sectionEl.props, onSaved: () => { saved += 1; } });
  assert.match(text(section), /OAuth callback/);
  assert.match(text(section), /Fixed address \u00b7 1 listeners/);
  assert.match(text(section), /Listener error/);

  const toggle = nodes(section).find((node) => node.type === 'button' && node.props['aria-label'] === 'OAuth callback');
  assert.ok(toggle, 'the header toggles the section');
  assert.equal(toggle.props['aria-expanded'], false);
  toggle.props.onClick();
  section = app.render(sectionEl.type, { ...sectionEl.props, onSaved: () => { saved += 1; } });
  const values = nodes(section).filter((node) => node.type === 'input').map((node) => node.props.value);
  assert.ok(values.includes('localhost'), 'the hostname is editable');
  assert.ok(values.includes('8765'), 'the fixed port is editable');
  assert.ok(values.includes('/callback'), 'the path is editable');
  assert.match(text(section), /127\.0\.0\.1:8765/);
  assert.match(text(section), /port 8765 is already in use/);

  const save = nodes(section).find((node) => node.type === 'button' && text(node) === 'Save');
  assert.ok(save, 'the section can be saved');
  await save.props.onClick();
  await settle();
  const put = calls.find((call) => call.url.endsWith('/settings/callback'));
  assert.ok(put, 'saving posts the configuration');
  assert.deepEqual(JSON.parse(put.options.body), { mode: 'fixed', host: 'localhost', port: '8765', path: '/callback' });
  assert.equal(saved, 1);
});

it('picks up the stored callback configuration after the page first rendered without it', async () => {
  const before = { onDemandToolInjection: false, oauthCallback: null, callbackStatus: { listeners: [], lastError: '' } };
  const after = {
    onDemandToolInjection: false,
    oauthCallback: { mode: 'fixed', host: 'localhost', port: 8765, path: '/oauth/return' },
    callbackStatus: { listeners: [], lastError: '' },
  };
  const app = mount(async (url) => {
    if (url.endsWith('/servers')) return response({ servers: [] });
    if (url.endsWith('/workspaces')) return response({ workspaces: [] });
    if (url.endsWith('/settings')) return response(before);
    return response({});
  });
  app.render();
  app.effects();
  await settle();
  const tree = app.render();
  const sectionEl = nodes(tree).find((node) => node.props?.settings && typeof node.props?.onSaved === 'function');
  assert.ok(sectionEl, 'the callback section renders');
  app.reset();
  let section = app.render(sectionEl.type, sectionEl.props);
  const toggle = nodes(section).find((node) => node.type === 'button' && node.props['aria-label'] === 'OAuth callback');
  toggle.props.onClick();
  section = app.render(sectionEl.type, sectionEl.props);
  assert.equal(nodes(section).filter((node) => node.type === 'input').map((node) => node.props.value).includes('8765'), false,
    'the first render only knows the defaults');

  // No reset: the same hook store must show the configuration the poll just
  // delivered. A useState initializer would keep the stale defaults and Save
  // would overwrite the real configuration with them.
  section = app.render(sectionEl.type, { ...sectionEl.props, settings: after });
  const values = nodes(section).filter((node) => node.type === 'input').map((node) => node.props.value);
  assert.ok(values.includes('8765'), 'the stored port is shown');
  assert.ok(values.includes('/oauth/return'), 'the stored path is shown');
});

it('uses a placeholder that does not pretend the automatic port is final', async () => {
  const server = {
    id: 'srv-auto', name: 'auto', type: 'http', url: 'https://mcp.example.com/mcp', authMode: 'oauth',
    status: 'needs-auth', error: '', toolCount: 0, enabled: true,
    clientId: '', clientSecretEnv: '', clientName: '', scope: '',
    redirectUrl: '', redirectMode: 'automatic', redirectUri: '', redirectDefaultUri: '',
  };
  const app = mount(async (url) => {
    if (url.endsWith('/servers')) return response({ servers: [server] });
    if (url.endsWith('/workspaces')) return response({ workspaces: [] });
    if (url.endsWith('/settings')) return response({ onDemandToolInjection: false });
    return response({});
  });
  let tree = app.render();
  app.effects();
  await settle();
  tree = app.render();
  const cardNode = nodes(tree).find((node) => node.props?.server?.id === 'srv-auto');
  cardNode.props.onEdit();
  tree = app.render();
  const formEl = content(tree);
  app.reset();
  const form = app.render(formEl.type, formEl.props);
  const input = nodes(form).find((node) => node.type === 'input' && node.props.placeholder === 'Port assigned at authentication');
  assert.ok(input, 'the placeholder says the port is assigned at authentication');
  assert.match(text(form), /callback port is assigned when you authenticate/);
});

it('shows the automatic notice for an override without a port on the card', async () => {
  const server = {
    id: 'srv-bare', name: 'bare', type: 'http', url: 'https://mcp.example.com/mcp', authMode: 'oauth',
    status: 'connected', error: '', toolCount: 1, enabled: true,
    redirectUrl: 'http://localhost', redirectMode: 'override', redirectUri: '',
    redirectLastUsedUri: 'http://localhost:3210/callback', redirectWarning: 'manual-client-automatic',
  };
  const app = mount(async (url) => {
    if (url.endsWith('/servers')) return response({ servers: [server] });
    if (url.endsWith('/workspaces')) return response({ workspaces: [] });
    if (url.endsWith('/settings')) return response({ onDemandToolInjection: false });
    return response({});
  });
  let tree = app.render();
  app.effects();
  await settle();
  tree = app.render();
  const cardNode = nodes(tree).find((node) => node.props?.server?.id === 'srv-bare');
  cardNode.props.onEdit();
  tree = app.render();
  const formEl = content(tree);
  app.reset();
  const form = app.render(formEl.type, formEl.props);
  const detailsEl = nodes(form).find((node) => typeof node.type === 'function' && node.props?.server?.id === 'srv-bare');
  const details = app.render(detailsEl.type, detailsEl.props);
  assert.match(text(details), /Port assigned at authentication/);
  assert.match(text(details), /Last used redirect URI/);
  assert.match(text(details), /http:\/\/localhost:3210\/callback/);
  assert.match(text(details), /manual Client ID needs a fixed URI/);
});

it('renders the callback section labels and status line', async () => {
  const settings = {
    onDemandToolInjection: false,
    oauthCallback: { mode: 'fixed', host: 'localhost', port: 8765, path: '/callback' },
    callbackStatus: { listeners: [], lastError: '' },
  };
  const app = mount(async (url) => {
    if (url.endsWith('/servers')) return response({ servers: [] });
    if (url.endsWith('/workspaces')) return response({ workspaces: [] });
    if (url.endsWith('/settings')) return response(settings);
    return response({});
  });
  let tree = app.render();
  app.effects();
  await settle();
  tree = app.render();
  const sectionEl = nodes(tree).find((node) => node.props?.settings && typeof node.props?.onSaved === 'function');
  app.reset();
  let section = app.render(sectionEl.type, sectionEl.props);
  assert.match(text(section), /OAuth callback/);
  section = app.render(sectionEl.type, sectionEl.props);
});
