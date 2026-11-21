/**
 * Compact conversation banner.
 *
 * The banner is a card on the composer own geometry, shows a bounded number
 * of rows and states only an actionable reason.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';

import { mountClient, nodes, response, settle, text } from './helpers/client-harness.js';

const SESSION = 'session-a';

function listing(items) { return response({ items }); }

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

function mount(fetch) {
  const app = mountClient(fetch, 'en');
  const banner = () => app.slot('conversation.input.dock');
  const render = (props = {}) => app.render(banner(), { t: app.t, sessionId: SESSION, ...props });
  return { app, render };
}

it('renders as a compact card on the composer geometry', async () => {
  const { app, render } = mount(async () => listing([waiting()]));
  render();
  app.effects();
  await settle();
  assert.ok(nodes(render()).find((node) => node.props?.className === 'mm_auth'), 'the banner renders');
  assert.ok(app.css.includes('composer-card-max-width'), 'the card takes the composer width');
  assert.ok(app.css.includes('dsw-specific-menu'), 'the card rides the composer surface');
  assert.ok(app.css.includes('dsw-elevation-panel'), 'the card keeps the composer elevation');
});

it('folds more than three waiting servers behind a summary', async () => {
  const many = [1, 2, 3, 4, 5].map((n) => waiting({ serverId: 'srv-' + n, name: 'server-' + n }));
  const { app, render } = mount(async () => listing(many));
  render();
  app.effects();
  await settle();
  const tree = render();
  const rows = nodes(tree).filter((node) => node.props?.className === 'mm_authRow');
  assert.equal(rows.length, 3, 'three rows are shown');
  const more = nodes(tree).find((node) => node.props?.className === 'mm_authMore');
  assert.ok(more, 'the remainder folds behind a summary');
  assert.match(text(more), /2 more waiting/);
});

it('keeps a single-row banner free of any summary', async () => {
  const { app, render } = mount(async () => listing([waiting()]));
  render();
  app.effects();
  await settle();
  assert.equal(nodes(render()).find((node) => node.props?.className === 'mm_authMore'), undefined);
});

it('states an actionable reason and omits a bare token rejection', async () => {
  const scopeCase = waiting({ error: 'insufficient scope (requires: feed:read): re-authenticate to grant access' });
  const tokenCase = waiting({ serverId: 'srv-2', name: 'other', reason: 'invalid_token', error: '' });
  const { app, render } = mount(async () => listing([scopeCase, tokenCase]));
  render();
  app.effects();
  await settle();
  const tree = render();
  assert.match(text(tree), /feed:read/, 'the scope requirement is stated');
  assert.doesNotMatch(text(tree), /invalid_token/, 'a plain token rejection is omitted');
});
