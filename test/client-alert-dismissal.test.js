/**
 * A dismissed alert must return for a NEW wait of the same server and conversation.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';

import { mountClient, nodes, response, settle } from './helpers/client-harness.js';

function waiting(overrides = {}) {
  return {
    waitId: 'w1',
    serverId: 'srv-1',
    sessionId: 'owner',
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

function mount(itemsRef) {
  const storage = { getItem: (key) => (key === 'dsh.sessions.current' ? JSON.stringify({ sessionId: 'elsewhere' }) : null) };
  const fetch = async (url) => (url.endsWith('/attention') ? response({ items: itemsRef.items }) : response({}));
  // Capture the poll so a test can advance it between renders.
  const intervals = [];
  const app = mountClient(fetch, 'en', {
    localStorage: storage,
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    clearInterval: () => {},
  });
  const render = () => app.render(app.slot('shell.overlay'), { t: app.t });
  const poll = async () => { for (const fn of intervals) await fn(); await settle(); };
  return { app, render, poll };
}

it('brings the alert back for a later wait of the same pair', async () => {
  const ref = { items: [waiting({ waitId: 'w1' })] };
  const { app, render, poll } = mount(ref);
  render();
  app.effects();
  await settle();
  nodes(render()).find((node) => node.props?.className === 'mm_alertDismiss').props.onClick();
  assert.equal(render(), null, 'the dismissed wait is hidden');
  ref.items = [waiting({ waitId: 'w2' })];
  await poll();
  assert.notEqual(render(), null, 'a new wait instance is announced again');
});

it('keeps a wait hidden while it is still the same instance', async () => {
  const ref = { items: [waiting({ waitId: 'same' })] };
  const { app, render } = mount(ref);
  render();
  app.effects();
  await settle();
  nodes(render()).find((node) => node.props?.className === 'mm_alertDismiss').props.onClick();
  render();
  await settle();
  assert.equal(render(), null, 'the same instance stays dismissed');
});
