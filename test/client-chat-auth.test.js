/**
 * Conversation authentication banner (v0.21.0).
 *
 * The real client factory runs in the vm harness: the banner polls the
 * attention endpoint, filters by session and workspace, renders the three
 * phases, and starts or cancels the existing authorization.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';

import { mountClient, nodes, response, settle, text } from './helpers/client-harness.js';

const SESSION = 'session-a';

function listing(items) {
  return response({ items });
}

function waiting(overrides = {}) {
  return {
    serverId: 'srv-1',
    sessionId: SESSION,
    scope: 'global',
    workspacePath: '',
    name: 'database',
    reason: 'invalid_token',
    error: '',
    phase: 'needs-auth',
    pending: 1,
    remainingMs: 90000,
    ...overrides,
  };
}

function buttons(tree) {
  return nodes(tree).filter((node) => node.type === 'button');
}

function button(tree, label) {
  return buttons(tree).find((node) => text(node).trim() === label);
}

function mount(fetch, globals = {}) {
  const app = mountClient(fetch, 'en', globals);
  const banner = () => app.slot('conversation.input.dock');
  const render = (props = {}) => app.render(banner(), { t: app.t, sessionId: SESSION, ...props });
  return { app, banner, render };
}

it('registers the banner above the composer and keeps the settings section', () => {
  const { app } = mount(async () => listing([]));
  assert.ok(app.slot('settings.section'), 'the settings section stays registered');
  const options = app.slotOptions('conversation.input.dock');
  assert.equal(options.id, 'mcp-manager-auth');
  assert.equal(options.order, 10);
  assert.equal(options.locale, 'mcp');
  assert.ok(app.slot('conversation.input.dock'), 'the banner component is registered');
});

it('renders nothing when nothing waits', async () => {
  const { app, render } = mount(async () => listing([]));
  render();
  app.effects();
  await settle();
  assert.equal(render(), null);
});

it('renders one row per waiting server owned by this session', async () => {
  const fetch = async (url) => {
    if (url.endsWith('/attention')) {
      return listing([
        waiting(),
        waiting({ serverId: 'srv-2', name: 'other-session', sessionId: 'session-b' }),
        waiting({ serverId: 'srv-3', name: 'workspace', scope: 'workspace', workspacePath: '/repo' }),
        waiting({ serverId: 'srv-4', name: 'elsewhere', scope: 'workspace', workspacePath: '/other', sessionId: 'session-c' }),
      ]);
    }
    return response({});
  };
  const { app, render } = mount(fetch);
  render();
  app.effects();
  await settle();
  const tree = render();
  const rows = nodes(tree).filter((node) => node.props?.className === 'mm_authRow');
  assert.equal(rows.length, 2, 'only calls of this session are listed');
  const labels = rows.map((row) => text(row).replace(/\s+/g, ' '));
  assert.match(labels[0], /database/);
  assert.match(labels[0], /invalid_token/);
  assert.match(labels[0], /1 call\(s\) waiting/);
  assert.match(labels[0], /1:30 left/);
  assert.match(labels[1], /workspace/);
  assert.match(labels[1], /Workspace/);
});

it('shows the authorizing phase without a second Authenticate action', async () => {
  const { app, render } = mount(async () => listing([waiting({ phase: 'authorizing' })]));
  render();
  app.effects();
  await settle();
  const tree = render();
  assert.match(text(tree), /Browser open/);
  const primary = nodes(tree).find((node) => node.type === 'button' && node.props?.className?.includes('primary'));
  assert.equal(text(primary).trim(), 'Waiting for browser…');
  assert.equal(primary.props.disabled, true);
  assert.ok(button(tree, 'Cancel'), 'Cancel stays available');
});

it('shows the last failed attempt and keeps Authenticate available', async () => {
  const { app, render } = mount(async () => listing([waiting({ error: 'access_denied' })]));
  render();
  app.effects();
  await settle();
  const tree = render();
  assert.match(text(tree), /access_denied/);
  const primary = nodes(tree).find((node) => node.type === 'button' && node.props?.className?.includes('primary'));
  assert.equal(text(primary).trim(), 'Authenticate');
  assert.equal(primary.props.disabled, false);
});

it('starts the global authorization and opens the provider page', async () => {
  const calls = [];
  let opened = 0;
  let started = false;
  const fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' });
    if (url.endsWith('/attention')) return listing([waiting(started ? { phase: 'authorizing' } : {})]);
    if (url.endsWith('/servers/srv-1/auth')) { started = true; return response({ authorizeUrl: 'https://provider.example/authorize?state=x' }); }
    return response({});
  };
  const { app, render } = mount(fetch, { window: { open: () => { opened += 1; return {}; } } });
  render();
  app.effects();
  await settle();
  button(render(), 'Authenticate').props.onClick();
  await settle();
  assert.equal(opened, 1);
  const authCall = calls.find((call) => call.url.endsWith('/auth'));
  assert.equal(authCall.method, 'POST');
  assert.equal(authCall.url, '/mcp-manager/api/servers/srv-1/auth');
  assert.match(text(render()), /Browser open/);
});

it('keeps a manual link when the browser window is blocked', async () => {
  const fetch = async (url) => {
    if (url.endsWith('/attention')) return listing([waiting()]);
    if (url.endsWith('/servers/srv-1/auth')) return response({ authorizeUrl: 'https://provider.example/authorize?state=x' });
    return response({});
  };
  const { app, render } = mount(fetch, { window: { open: () => null } });
  render();
  app.effects();
  await settle();
  button(render(), 'Authenticate').props.onClick();
  await settle();
  const link = nodes(render()).find((node) => node.type === 'a');
  assert.equal(link.props.href, 'https://provider.example/authorize?state=x');
  assert.equal(text(link), 'Open the authorization page');
});

it('starts a workspace authorization through the workspace endpoint', async () => {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET', body: options.body });
    if (url.endsWith('/attention')) return listing([waiting({ scope: 'workspace', workspacePath: '/repo' })]);
    if (url.endsWith('/workspaces/auth')) return response({ authorizeUrl: 'https://provider.example/authorize?state=y' });
    return response({});
  };
  const { app, render } = mount(fetch, { window: { open: () => ({}) } });
  render();
  app.effects();
  await settle();
  button(render(), 'Authenticate').props.onClick();
  await settle();
  const call = calls.find((entry) => entry.url.endsWith('/workspaces/auth'));
  assert.equal(call.method, 'POST');
  assert.deepEqual(JSON.parse(call.body), { path: '/repo', name: 'database' });
});

it('cancels the waiting calls and drops the row', async () => {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET', body: options.body });
    if (url.endsWith('/attention')) return listing([waiting()]);
    if (url.endsWith('/attention/cancel')) return response({ canceled: 1, released: false });
    return response({});
  };
  const { app, render } = mount(fetch);
  render();
  app.effects();
  await settle();
  button(render(), 'Cancel').props.onClick();
  await settle();
  const call = calls.find((entry) => entry.url.endsWith('/attention/cancel'));
  assert.equal(call.method, 'POST');
  assert.deepEqual(JSON.parse(call.body), { sessionId: SESSION, serverId: 'srv-1' });
  assert.equal(render(), null, 'the row disappears right after the cancel');
});

it('reports a failed start inline without dropping the row', async () => {
  const fetch = async (url) => {
    if (url.endsWith('/attention')) return listing([waiting()]);
    if (url.endsWith('/servers/srv-1/auth')) return response({ error: 'callback port is busy' }, false, 500);
    return response({});
  };
  const { app, render } = mount(fetch);
  render();
  app.effects();
  await settle();
  button(render(), 'Authenticate').props.onClick();
  await settle();
  const tree = render();
  assert.match(text(tree), /callback port is busy/);
  assert.ok(button(tree, 'Cancel'), 'the control stays available');
});

it('localizes the banner in both languages', async () => {
  const { app, render } = mount(async () => listing([waiting()]));
  render();
  app.effects();
  await settle();
  assert.match(text(render()), /MCP authentication required/);
  assert.ok(button(render(), 'Authenticate'));
  app.setLocale('zh');
  assert.match(text(render()), /MCP 需要认证/);
  assert.ok(button(render(), '去认证'));
  assert.ok(button(render(), '取消'));
});

it('polls every two seconds and ticks the countdown every second', async () => {
  const intervals = [];
  const { app, render } = mount(async () => listing([waiting()]), {
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval: () => {},
  });
  render();
  app.effects();
  await settle();
  assert.deepEqual(intervals.map((entry) => entry.ms), [2000, 1000]);
});

it('drops the banner when a later poll finds no waiting call', async () => {
  let items = [waiting()];
  const intervals = [];
  const fetch = async (url) => (url.endsWith('/attention') ? listing(items) : response({}));
  const { app, render } = mount(fetch, {
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval: () => {},
  });
  render();
  app.effects();
  await settle();
  assert.notEqual(render(), null);
  items = [];
  const poll = intervals.find((entry) => entry.ms === 2000).fn;
  poll();
  await settle();
  assert.equal(render(), null);
});

it('drops the banner after consecutive attention read failures', async () => {
  let healthy = true;
  const intervals = [];
  const fetch = async (url) => {
    if (url.endsWith('/attention')) return healthy ? listing([waiting()]) : response({ error: 'host unavailable' }, false, 500);
    return response({});
  };
  const { app, render } = mount(fetch, {
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval: () => {},
  });
  render();
  app.effects();
  await settle();
  assert.notEqual(render(), null);
  healthy = false;
  const poll = intervals.find((entry) => entry.ms === 2000).fn;
  poll();
  await settle();
  assert.notEqual(render(), null, 'one failed poll keeps the last listing');
  poll();
  await settle();
  assert.equal(render(), null, 'a host that stopped answering does not leave stale rows');
});

it('clears both intervals when the conversation unmounts', async () => {
  const cleared = [];
  const { app, render } = mount(async () => listing([waiting()]), {
    setInterval: () => 1,
    clearInterval: (id) => cleared.push(id),
  });
  render();
  app.effects();
  await settle();
  app.unmount();
  assert.deepEqual(cleared, [1, 1], 'the poll and the countdown tick are both cleared');
});
