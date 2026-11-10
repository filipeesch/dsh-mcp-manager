/**
 * Client half: the per-server tool inventory and the add-action toolbar.
 *
 * The page container owns the inventory request (on expand and on every poll
 * while the card stays open); the cards only render the state they receive.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mountClient as mount, response, settle, nodes, text } from './helpers/client-harness.js';

const server = (overrides = {}) => ({
  id: 'srv-1', name: 'github', type: 'http', url: 'https://example.test/mcp',
  authMode: 'none', status: 'connected', enabled: true, toolCount: 2,
  ...overrides,
});

function mountPage({ servers = [], workspaces = [], settings = {}, tools = () => ({ tools: [] }), toolsFetch } = {}) {
  const calls = [];
  const app = mount(async (url) => {
    calls.push(url);
    if (url.endsWith('/servers')) return response({ servers });
    if (url.endsWith('/workspaces')) return response({ workspaces });
    if (url.endsWith('/settings')) return response(settings);
    if (/\/servers\/[^/]+\/tools$/.test(url)) return toolsFetch ? toolsFetch(url) : response(tools(url));
    return response({});
  });
  return { app, calls };
}

async function ready(page) {
  page.app.render();
  page.app.effects();
  await settle();
  return page.app.render();
}

function rowFor(tree, id) {
  return nodes(tree).find((node) => node.props?.server?.id === id);
}

it('fetches the inventory when a connected card expands and repolls while it stays open', async () => {
  let inventory = { tools: ['alpha', 'zulu'] };
  const page = mountPage({ servers: [server()], tools: () => inventory });
  const tree = await ready(page);

  let row = rowFor(tree, 'srv-1');
  assert.equal(row.props.tools, undefined, 'nothing is fetched before the card opens');
  row.props.onToggle();
  await settle(); await settle();

  const expandedTree = page.app.render();
  row = rowFor(expandedTree, 'srv-1');
  assert.equal(row.props.open, true);
  assert.equal(row.props.tools?.phase, 'ready');
  assert.deepEqual(row.props.tools.names, ['alpha', 'zulu']);
  assert.ok(page.calls.some((url) => url.endsWith('/servers/srv-1/tools')), 'the expand fetches the inventory');

  // A reconnect changes the inventory while the card is open; the poll path
  // (onChanged is the page refresh) must pick it up without collapsing the card.
  inventory = { tools: ['beta'] };
  row.props.onChanged();
  await settle(); await settle();
  row = rowFor(page.app.render(), 'srv-1');
  assert.deepEqual(row.props.tools.names, ['beta']);

  page.app.reset();
  const card = page.app.render(row.type, { ...row.props, open: true });
  assert.match(text(card), /Tools: 1/);
  assert.match(text(card), /beta/);
  assert.doesNotMatch(text(card), /alpha/, 'the reconnect replaced the previous inventory');
  assert.ok(nodes(card).every((node) => node.type !== 'code' || !String(node.props.className).includes('mm_toolName') || !text(node).startsWith('mcp__')),
    'the card renders raw names, never the prefixed public name');
});

it('keeps a loaded inventory when a background refresh fails', async () => {
  let failing = false;
  const page = mountPage({
    servers: [server({ toolCount: 1 })],
    toolsFetch: () => (failing ? response({ error: 'server is not connected' }, false, 409) : response({ tools: ['alpha'] })),
  });
  const tree = await ready(page);
  const row = rowFor(tree, 'srv-1');
  row.props.onToggle();
  await settle(); await settle();
  let expanded = rowFor(page.app.render(), 'srv-1');
  assert.deepEqual(expanded.props.tools.names, ['alpha']);

  failing = true;
  expanded.props.onChanged();
  await settle(); await settle();
  expanded = rowFor(page.app.render(), 'srv-1');
  assert.equal(expanded.props.tools.phase, 'ready', 'a failed poll does not replace a ready inventory');
  assert.deepEqual(expanded.props.tools.names, ['alpha']);

  page.app.reset();
  const card = page.app.render(expanded.type, { ...expanded.props, open: true });
  assert.match(text(card), /alpha/);
  assert.doesNotMatch(text(card), /Could not load the tool list/);
});

it('drops the inventory on collapse and when the poll reports the server left connected', async () => {
  let inventory = { tools: ['alpha'] };
  const live = server({ toolCount: 1 });
  const page = mountPage({ servers: [live], tools: () => inventory });
  const tree = await ready(page);
  let row = rowFor(tree, 'srv-1');
  row.props.onToggle();
  await settle(); await settle();
  row = rowFor(page.app.render(), 'srv-1');
  assert.deepEqual(row.props.tools.names, ['alpha']);

  // Collapse drops the cached names, so a later reconnect cannot flash the
  // previous connection's list while the new read is in flight.
  row.props.onToggle();
  await settle();
  row = rowFor(page.app.render(), 'srv-1');
  assert.equal(row.props.open, false);
  assert.equal(row.props.tools, undefined, 'collapse drops the cached inventory');
  inventory = { tools: ['beta'] };
  row.props.onToggle();
  const loading = rowFor(page.app.render(), 'srv-1');
  assert.equal(loading.props.tools.phase, 'loading', 'no stale list while the new read runs');
  await settle(); await settle();
  assert.deepEqual(rowFor(page.app.render(), 'srv-1').props.tools.names, ['beta']);

  // A poll that reports the server left `connected` drops the entry as well.
  live.status = 'error';
  rowFor(page.app.render(), 'srv-1').props.onChanged();
  await settle(); await settle();
  const failed = rowFor(page.app.render(), 'srv-1');
  assert.equal(failed.props.server.status, 'error');
  assert.equal(failed.props.tools, undefined, 'a disconnected card keeps no inventory');
});

it('reports a first read failure and recovers on the next poll', async () => {
  let failing = true;
  const page = mountPage({
    servers: [server({ toolCount: 1 })],
    toolsFetch: () => (failing ? response({ error: 'server is not connected' }, false, 409) : response({ tools: ['alpha'] })),
  });
  const tree = await ready(page);
  const row = rowFor(tree, 'srv-1');
  row.props.onToggle();
  await settle(); await settle();
  let expanded = rowFor(page.app.render(), 'srv-1');
  assert.equal(expanded.props.tools.phase, 'error');
  assert.equal(expanded.props.tools.status, 409);

  failing = false;
  expanded.props.onChanged();
  await settle(); await settle();
  expanded = rowFor(page.app.render(), 'srv-1');
  assert.deepEqual(expanded.props.tools.names, ['alpha']);
  page.app.reset();
  const card = page.app.render(expanded.type, { ...expanded.props, open: true });
  assert.match(text(card), /alpha/);
  assert.doesNotMatch(text(card), /Could not load the tool list/);
});

it('starts the on-demand switch enabled before the settings request resolves', () => {
  const page = mountPage({});
  const tree = page.app.render();
  const toggle = nodes(tree).find((node) => node.type === 'button' && node.props['aria-label'] === 'On-demand MCP tool calls');
  assert.ok(toggle);
  assert.equal(toggle.props['data-on'], 'true');
  assert.equal(toggle.props['aria-checked'], true);
});

it('keeps every non-connected state distinct and never fabricates a list', async () => {
  const page = mountPage({ servers: [server()] });
  const tree = await ready(page);
  const template = rowFor(tree, 'srv-1');
  const t = template.props.t;

  const states = [
    ['needs-auth', /Authenticate to see this server's tools/],
    ['error', /Tools are unavailable while this server is failing/],
    ['disabled', /This server is disabled, so it exposes no tools/],
    ['connecting', /Connecting — tools will appear when the server is ready/],
    ['configured', /Not connected yet/],
    ['conflict', /conflicts with another server name/],
  ];
  for (const [status, message] of states) {
    page.app.reset();
    const card = page.app.render(template.type, {
      t, server: server({ status, disabled: status === 'disabled', enabled: status !== 'disabled' }), tools: undefined,
      open: true, onToggle: () => {}, onChanged: () => {}, onEdit: () => {},
    });
    assert.match(text(card), message, status);
    assert.equal(nodes(card).filter((node) => node.type === 'code').length, 0, status + ' renders no names');
  }

  for (const [tools, message] of [
    [{ phase: 'ready', names: [] }, /Connected, but this server exposes no tools/],
    [{ phase: 'error', error: 'server is not connected' }, /Could not load the tool list/],
    [{ phase: 'loading', names: [] }, /Loading tools/],
  ]) {
    page.app.reset();
    const card = page.app.render(template.type, {
      t, server: server(), tools, open: true, onToggle: () => {}, onChanged: () => {}, onEdit: () => {},
    });
    assert.match(text(card), message);
  }
});

it('renders a long list inside its bounded area and keeps long names intact', async () => {
  const names = Array.from({ length: 200 }, (_, index) => `tool_${String(index).padStart(3, '0')}`);
  names[7] = 'a_very_long_tool_name_that_would_overflow_the_card_if_it_did_not_wrap';
  const page = mountPage({ servers: [server({ toolCount: names.length })], tools: () => ({ tools: names }) });
  const tree = await ready(page);
  const row = rowFor(tree, 'srv-1');
  row.props.onToggle();
  await settle(); await settle();

  const expanded = rowFor(page.app.render(), 'srv-1');
  page.app.reset();
  const card = page.app.render(expanded.type, { ...expanded.props, open: true });
  const list = nodes(card).find((node) => node.props?.className === 'mm_toolList');
  assert.ok(list, 'the names live in a dedicated scroll area');
  const rendered = nodes(card).filter((node) => node.type === 'code' && node.props.className === 'mm_toolName');
  assert.equal(rendered.length, names.length, 'every tool is rendered and reachable');
  assert.ok(rendered.some((node) => text(node) === names[7]), 'long names are not truncated in the data');
});

it('shows the workspace card with its own connection and fetches that id', async () => {
  const wsServer = server({ id: 'ws-1', name: 'local', source: 'workspace', toolCount: 1 });
  const workspaces = [{ path: '/ws', servers: [wsServer], exclude: [], disabled: [], error: '' }];
  const page = mountPage({
    workspaces,
    tools: (url) => ({ tools: url.includes('/servers/ws-1/tools') ? ['workspace_tool'] : ['global_tool'] }),
  });
  let tree = await ready(page);
  nodes(tree).find((node) => node.props?.className === 'mm_wsSelect').props.onChange({ target: { value: '/ws' } });
  tree = page.app.render();

  let row = rowFor(tree, 'ws-1');
  assert.ok(row, 'the workspace row renders');
  row.props.onToggle();
  await settle(); await settle();
  row = rowFor(page.app.render(), 'ws-1');
  assert.deepEqual(row.props.tools.names, ['workspace_tool']);

  page.app.reset();
  const card = page.app.render(row.type, { ...row.props, open: true });
  assert.match(text(card), /workspace_tool/);
  assert.doesNotMatch(text(card), /global_tool/);
});

it('renders the tool heading and the state messages in English', async () => {
  const page = mountPage({ servers: [server()], tools: () => ({ tools: ['alpha'] }) });
  const tree = await ready(page);
  const row = rowFor(tree, 'srv-1');
  row.props.onToggle();
  await settle(); await settle();
  const expanded = rowFor(page.app.render(), 'srv-1');

  page.app.reset();
  const card = page.app.render(expanded.type, { ...expanded.props, open: true });
  assert.match(text(card), /Tools: 1/);

  page.app.reset();
  const disabled = page.app.render(expanded.type, {
    ...expanded.props, open: true, tools: undefined,
    server: server({ status: 'disabled', disabled: true }),
  });
  assert.match(text(disabled), /This server is disabled/);
});

it('shows the retained names with a stale badge while authentication is required', async () => {
  const page = mountPage({
    servers: [server({ status: 'needs-auth' })],
    tools: () => ({ tools: ['alpha', 'zebra'], stale: true }),
  });
  const tree = await ready(page);
  const row = rowFor(tree, 'srv-1');
  row.props.onToggle();
  await settle(); await settle();
  const expanded = rowFor(page.app.render(), 'srv-1');

  page.app.reset();
  const card = page.app.render(expanded.type, { ...expanded.props, open: true });
  assert.match(text(card), /Tools: 2/);
  assert.match(text(card), /alpha/);
  assert.match(text(card), /zebra/);
  assert.match(text(card), /Cached from the last successful listing/);
});

it('shows the authentication message when a server in needs-auth has no catalog', async () => {
  const page = mountPage({
    servers: [server({ status: 'needs-auth' })],
    toolsFetch: () => response({ error: 'server is not connected' }, false, 409),
  });
  const tree = await ready(page);
  const row = rowFor(tree, 'srv-1');
  row.props.onToggle();
  await settle(); await settle();
  const expanded = rowFor(page.app.render(), 'srv-1');

  page.app.reset();
  const card = page.app.render(expanded.type, { ...expanded.props, open: true });
  assert.match(text(card), /Authentication required/);
  assert.doesNotMatch(text(card), /Cached from the last successful listing/);
  assert.doesNotMatch(text(card), /Could not load the tool list/);
});

it('reports a failed inventory read for a server in needs-auth instead of hiding it', async () => {
  const page = mountPage({
    servers: [server({ status: 'needs-auth' })],
    toolsFetch: () => response({ error: 'internal error' }, false, 500),
  });
  const tree = await ready(page);
  const row = rowFor(tree, 'srv-1');
  row.props.onToggle();
  await settle(); await settle();
  const expanded = rowFor(page.app.render(), 'srv-1');

  page.app.reset();
  const card = page.app.render(expanded.type, { ...expanded.props, open: true });
  assert.match(text(card), /Could not load the tool list/);
  // The status chip still says "Authentication required"; the tool section must
  // not pretend the server simply has no catalog to show.
  assert.doesNotMatch(text(card), /Authenticate to see this server's tools/);
});

it('places the add action in the search toolbar and removes it from the header', async () => {
  const page = mountPage({});
  let tree = await ready(page);
  const toolbar = nodes(tree).find((node) => node.props?.className === 'mm_toolbar');
  assert.ok(toolbar, 'the search lives in a toolbar');
  const addInToolbar = nodes(toolbar).find((node) => node.type === 'button' && node.props['aria-label'] === 'Add MCP server');
  assert.ok(addInToolbar, 'the add action shares the toolbar with the search');
  assert.equal(addInToolbar.props.className, 'mm_addBtn');
  tree = page.app.render();
  const heading = nodes(tree).find((node) => node.props?.className === 'mm_catalogHeading');
  assert.ok(!nodes(heading).some((node) => node.type === 'button'), 'the header no longer offers the add action');

  nodes(tree).find((node) => node.type === 'button' && node.props.className === 'mm_addBtn').props.onClick();
  tree = page.app.render();
  assert.match(text(tree), /Add MCP server/);
});

it('places the add action next to the workspace selector in the workspace view', async () => {
  const workspaces = [{ path: '/ws', servers: [], exclude: [], disabled: [], error: '' }];
  const page = mountPage({ workspaces });
  let tree = await ready(page);
  nodes(tree).find((node) => node.props?.className === 'mm_wsSelect').props.onChange({ target: { value: '/ws' } });
  tree = page.app.render();

  const bar = nodes(tree).find((node) => node.props?.className === 'mm_wsBar');
  assert.ok(bar, 'the workspace selector row renders');
  assert.ok(nodes(bar).some((node) => node.type === 'button' && node.props['aria-label'] === 'Add MCP server'),
    'the workspace view keeps the add action beside the selector');
  assert.ok(!nodes(tree).some((node) => node.props?.className === 'mm_toolbar'), 'the search toolbar is global-only');
  assert.match(text(tree), /Use ＋ next to the workspace selector/);
});
