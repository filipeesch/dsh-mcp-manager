/**
 * Frame-wide authentication alert.
 *
 * A wait owned by a conversation the operator cannot see is announced on every
 * screen, names the server and that conversation, and offers both ways to
 * unblock it without navigating away.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';

import { mountClient, nodes, response, settle, text } from './helpers/client-harness.js';

const OWNER = 'session-owner';
const OTHER = 'session-other';

function listing(items) { return response({ items }); }

function waiting(overrides = {}) {
  return {
    serverId: 'srv-1',
    sessionId: OWNER,
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

/** Mount the overlay slot with a chosen persisted selection. */
function mount(fetch, { selected = OTHER, titles = {}, openSession = undefined, modalOpen = false, window: windowStub = undefined } = {}) {
  const storage = {
    getItem: (key) => (key === 'dsh.sessions.current' ? JSON.stringify({ sessionId: selected }) : null),
  };
  const documentStub = {
    querySelector: () => (modalOpen ? { role: 'dialog' } : null),
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: () => {} },
  };
  const app = mountClient(fetch, 'en', {
    localStorage: storage,
    document: documentStub,
    ...(windowStub ? { window: windowStub } : {}),
  });
  const alert = () => app.slot('shell.overlay');
  const render = () => app.render(alert(), { t: app.t, sessionTitles: titles, openSession });
  return { app, render };
}

it('registers on the frame-wide overlay, not only in a conversation', () => {
  const { app } = mount(async () => listing([]));
  const options = app.slotOptions('shell.overlay');
  assert.ok(options, 'the alert is registered on shell.overlay');
  assert.equal(options.id, 'mcp-manager-alert');
});

it('announces a wait owned by another conversation', async () => {
  const { app, render } = mount(async () => listing([waiting()]));
  render();
  app.effects();
  await settle();
  const cards = nodes(render()).filter((node) => node.props?.className === 'mm_alertCard');
  assert.equal(cards.length, 1, 'one card for the hidden wait');
});

it('stays silent when the operator is looking at the owning conversation', async () => {
  const { app, render } = mount(async () => listing([waiting()]), { selected: OWNER });
  render();
  app.effects();
  await settle();
  assert.equal(render(), null, 'the conversation banner already reports it');
});

it('appears over an open modal even for the owning conversation', async () => {
  const { app, render } = mount(async () => listing([waiting()]), { selected: OWNER, modalOpen: true });
  render();
  app.effects();
  await settle();
  assert.notEqual(render(), null, 'the modal is where the operator is acting');
});

it('shows when the selection cannot be read, rather than hiding a real wait', async () => {
  const app = mountClient(async () => listing([waiting()]), 'en', {
    localStorage: { getItem: () => { throw new Error('blocked'); } },
  });
  const render = () => app.render(app.slot('shell.overlay'), { t: app.t });
  render();
  app.effects();
  await settle();
  assert.notEqual(render(), null, 'an unreadable selection shows the alert');
});

it('names the server and the owning conversation', async () => {
  const { app, render } = mount(async () => listing([waiting()]), { titles: { [OWNER]: 'Trip planning' } });
  render();
  app.effects();
  await settle();
  const body = text(render());
  assert.match(body, /database/);
  assert.match(body, /Trip planning/);
});

it('degrades to the server name when the conversation has no title', async () => {
  const { app, render } = mount(async () => listing([waiting()]));
  render();
  app.effects();
  await settle();
  const body = text(render());
  assert.match(body, /database/);
  assert.ok(!body.includes(OWNER), 'no internal identifier is shown');
});

it('opens the owning conversation without leaving the current screen first', async () => {
  const opened = [];
  const { app, render } = mount(async () => listing([waiting()]), { openSession: (id) => opened.push(id) });
  render();
  app.effects();
  await settle();
  const go = nodes(render()).find((node) => node.type === 'button' && text(node).trim() === 'Go to conversation');
  go.props.onClick();
  assert.deepEqual(opened, [OWNER]);
});

it('authenticates from outside the conversation and reports a failure in the card', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/attention')) return listing([waiting()]);
    if (url.endsWith('/auth')) return response({ error: 'callback port is busy' }, false, 500);
    return response({});
  };
  const { app, render } = mount(fetch);
  render();
  app.effects();
  await settle();
  const auth = nodes(render()).find((node) => node.type === 'button' && text(node).trim() === 'Authenticate');
  await auth.props.onClick();
  await settle();
  const call = calls.find((url) => url.endsWith('/auth'));
  assert.equal(call, '/mcp-manager/api/servers/srv-1/auth');
  assert.match(text(render()), /callback port is busy/);
});

it('dismisses without cancelling and comes back for a later wait', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/attention')) return listing([waiting()]);
    return response({});
  };
  const { app, render } = mount(fetch);
  render();
  app.effects();
  await settle();
  const dismiss = nodes(render()).find((node) => node.props?.className === 'mm_alertDismiss');
  dismiss.props.onClick();
  assert.equal(render(), null, 'the dismissed alert is gone');
  assert.ok(!calls.some((url) => url.endsWith('/attention/cancel')), 'dismissing never cancels the wait');
});

it('bounds the visible cards and folds the remainder', async () => {
  const many = [1, 2, 3, 4, 5].map((n) => waiting({ serverId: 'srv-' + n, name: 'server-' + n, sessionId: 's-' + n }));
  const { app, render } = mount(async () => listing(many));
  render();
  app.effects();
  await settle();
  const tree = render();
  const cards = nodes(tree).filter((node) => node.props?.className === 'mm_alertCard');
  assert.equal(cards.length, 3);
  const more = nodes(tree).find((node) => node.props?.className === 'mm_alertMore');
  assert.match(text(more), /2 more/);
});

it('states a scope requirement neutrally and a failed attempt as an error', async () => {
  const scopeWait = waiting({ serverId: 'srv-scope', name: 'observability', error: 'insufficient scope (requires: feed:read)', sessionId: 'session-x' });
  const { app, render } = mount(async () => listing([scopeWait]));
  render();
  app.effects();
  await settle();
  const tree = render();
  const note = nodes(tree).find((node) => node.props?.className === 'mm_alertNote');
  assert.ok(note, 'the scope requirement is a neutral note');
  assert.equal(nodes(tree).find((node) => node.props?.className === 'mm_alertErr'), undefined, 'it is not painted as an error');
});

it('states what the alert wants before naming the server', async () => {
  const { app, render } = mount(async () => listing([waiting()]));
  render();
  app.effects();
  await settle();
  const tree = render();
  const title = nodes(tree).find((node) => node.props?.className === 'mm_alertTitle');
  assert.ok(title, 'the card carries a requirement heading');
  assert.equal(text(title), 'Authentication required');
  // The heading must precede the server name, so it reads as the reason.
  const ordered = text(tree).indexOf('Authentication required') < text(tree).indexOf('database');
  assert.equal(ordered, true, 'the requirement is stated before the server');
});

it('reopens the cached authorization URL instead of starting a second flow', async () => {
  const calls = [];
  const opened = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/attention')) return listing([waiting()]);
    if (url.endsWith('/auth')) return response({ authorizeUrl: 'https://provider.example/authorize?state=s1' });
    return response({});
  };
  // The first popup is blocked, so the card caches the URL and offers a retry.
  let allow = false;
  const { app, render } = mount(fetch, {
    window: { open: (target) => { opened.push(target); return allow ? {} : null; } },
  });
  render();
  app.effects();
  await settle();
  nodes(render()).find((node) => node.type === 'button' && text(node).trim() === 'Authenticate').props.onClick();
  await settle();
  const authCalls = () => calls.filter((url) => url.endsWith('/auth')).length;
  assert.equal(authCalls(), 1, 'the first attempt started one flow');

  // Now the operator allows the popup and uses the retry action.
  allow = true;
  const retry = nodes(render()).find((node) => node.type === 'button' && text(node).trim() === 'Open the authorization page again');
  assert.ok(retry, 'a blocked popup offers a retry');
  retry.props.onClick();
  await settle();
  assert.equal(authCalls(), 1, 'the retry did not start a second authorization flow');
  assert.equal(opened.at(-1), 'https://provider.example/authorize?state=s1', 'the retry reopened the same URL');
});
