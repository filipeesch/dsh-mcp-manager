import assert from 'node:assert/strict';
import { it } from 'node:test';

import {
  mountClient,
  nodes,
  response,
  settle,
  text,
} from './helpers/client-harness.js';

const byClass = (tree, className) => nodes(tree).find((node) => node.props.className === className);
const allByClass = (tree, className) => nodes(tree).filter((node) => node.props.className === className);
const byLabel = (tree, label) => nodes(tree).find((node) => node.props['aria-label'] === label);
const buttonByText = (tree, value) => nodes(tree).find((node) => node.type === 'button' && text(node) === value);
const componentOf = (tree, predicate) => nodes(tree).find((node) => typeof node.type === 'function' && predicate(node));

const SERVERS = [{
  id: 'g1',
  name: 'github',
  type: 'http',
  url: 'https://api.github.com/mcp',
  authMode: 'oauth',
  status: 'needs-auth',
  enabled: true,
  toolCount: 0,
}];

function router(overrides = {}) {
  return async (url, options = {}) => {
    const path = url.replace('/mcp-manager/api', '');
    if (overrides[path]) return overrides[path](options);
    if (path === '/servers') return response({ servers: SERVERS });
    if (path === '/workspaces') return response({ workspaces: [{ path: '/ws/a', servers: [], exclude: [], disabled: [], error: '' }] });
    if (path === '/settings') return response({ onDemandToolInjection: false, oauthCallback: null, callbackStatus: null });
    return response({});
  };
}

async function openList(fetch) {
  const app = mountClient(fetch);
  app.render();
  app.effects();
  await settle();
  return app;
}

const planOf = (entries, summary) => ({
  plan: {
    scope: 'global',
    path: null,
    mode: 'edit',
    entries,
    summary: summary ?? { new: 0, update: 0, unchanged: 0, conflict: 0, invalid: 0, delete: 0 },
    blocked: null,
    applyCount: entries.length,
  },
});

const entry = (overrides) => ({
  changes: [],
  keepsSession: false,
  staysDisabled: false,
  conflict: null,
  resolution: null,
  error: null,
  notes: [],
  ...overrides,
});

// Open the menu and mount the dialog the page would render, on a clean state
// array so its own hooks are the first slots.
function openDialog(app, label = 'Edit JSON') {
  byLabel(app.render(), 'More actions').props.onClick({ stopPropagation() {} });
  allByClass(app.render(), 'mm_menuItem').find((item) => text(item) === label).props.onClick();
  const pageTree = app.render();
  const node = componentOf(pageTree, (candidate) => typeof candidate.props.onApplied === 'function' && candidate.props.mode);
  assert.ok(node, 'the dialog is mounted');
  app.reset();
  const props = { ...node.props, onApplied() {}, onClose() {} };
  return { props, render: () => app.render(node.type, props) };
}

it('puts the overflow menu next to the add action in the global toolbar', async () => {
  const app = await openList(router());
  const tree = app.render();
  const toolbar = byClass(tree, 'mm_toolbar');
  assert.ok(toolbar, 'the global view has a toolbar');
  const labels = toolbar.children.map((child) => nodes(child).find((node) => node.props['aria-label'])?.props['aria-label']);
  assert.deepEqual(labels, ['Search MCP servers', 'Add MCP server', 'More actions']);
});

it('offers the two menu entries and seeds them differently', async () => {
  const app = await openList(router());
  let tree = app.render();
  byLabel(tree, 'More actions').props.onClick({ stopPropagation() {} });
  tree = app.render();
  const items = allByClass(tree, 'mm_menuItem');
  assert.deepEqual(items.map((item) => text(item)), ['Edit JSON', 'Import JSON']);

  items.find((item) => text(item) === 'Edit JSON').props.onClick();
  tree = app.render();
  const editDialog = componentOf(tree, (node) => typeof node.props.onApplied === 'function' && node.props.mode);
  assert.equal(editDialog.props.mode, 'edit');
  assert.equal(editDialog.props.scope, 'global');
  assert.deepEqual(Object.keys(editDialog.props.seed.mcpServers), ['github']);
  assert.equal(editDialog.props.seed.mcpServers.github.url, 'https://api.github.com/mcp');
  assert.equal(editDialog.props.seed.mcpServers.github.authMode, 'oauth');

  const imported = await openList(router());
  tree = imported.render();
  byLabel(tree, 'More actions').props.onClick({ stopPropagation() {} });
  tree = imported.render();
  allByClass(tree, 'mm_menuItem').find((item) => text(item) === 'Import JSON').props.onClick();
  tree = imported.render();
  const importDialog = componentOf(tree, (node) => typeof node.props.onApplied === 'function' && node.props.mode);
  assert.equal(importDialog.props.mode, 'import');
  assert.deepEqual(JSON.parse(JSON.stringify(importDialog.props.seed)), { mcpServers: {} });
});

it('renders the plan, blocks apply on a conflict and applies the chosen replacement', async () => {
  const requests = [];
  const app = await openList(router({
    '/import': async (options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (body.dryRun) {
        return response(planOf([
          entry({ name: 'github', action: 'update', keepsSession: true, changes: [{ field: 'url', from: 'https://api.github.com/mcp', to: 'https://api.github.com/v2' }] }),
          entry({ name: 'shared', action: 'conflict', conflict: { scope: 'workspace', path: '/ws/a', enabled: true } }),
        ]));
      }
      return response({ plan: planOf([]).plan, applied: true });
    },
  }));
  const dialog = openDialog(app);
  let tree = dialog.render();
  buttonByText(tree, 'Preview').props.onClick();
  await settle();
  tree = dialog.render();

  const rows = allByClass(tree, 'mm_planRow');
  assert.equal(rows.length, 2);
  assert.match(text(rows[0]), /Update github/);
  assert.match(text(rows[0]), /url/);
  assert.match(text(rows[1]), /Conflict shared/);
  assert.match(text(rows[1]), /Name already used in Workspace/);

  const applyBtn = () => nodes(tree).find((node) => node.props.className === 'mm_btn primary');
  assert.equal(applyBtn().props.disabled, true, 'an undecided conflict blocks the batch');
  assert.match(text(tree), /Choose keep or replace for 1 conflict\(s\)/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].dryRun, true);
  assert.equal(requests[0].mode, 'edit');
  assert.equal(requests[0].scope, 'global');

  const radios = nodes(tree).filter((node) => node.props.type === 'radio');
  assert.equal(radios.length, 2);
  radios[1].props.onChange();
  tree = dialog.render();
  assert.equal(applyBtn().props.disabled, false);
  assert.match(text(applyBtn()), /Apply 2/);

  applyBtn().props.onClick();
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].dryRun, false);
  assert.deepEqual(requests[1].resolutions, { shared: 'replace' });
});

it('reports an invalid entry and keeps apply disabled', async () => {
  const app = await openList(router({
    '/import': async () => response(planOf([
      entry({ name: 'bad', action: 'invalid', error: { field: 'url', message: 'url must be an http(s) URL' } }),
    ], { new: 0, update: 0, unchanged: 0, conflict: 0, invalid: 1, delete: 0 })),
  }));
  const dialog = openDialog(app);
  let tree = dialog.render();
  buttonByText(tree, 'Preview').props.onClick();
  await settle();
  tree = dialog.render();
  assert.match(text(tree), /url: url must be an http\(s\) URL/);
  assert.match(text(tree), /Nothing will be written: 1 invalid entry\(ies\)/);
  assert.equal(nodes(tree).find((node) => node.props.className === 'mm_btn primary').props.disabled, true);
});

it('asks for confirmation before a batch that deletes servers', async () => {
  const requests = [];
  const app = await openList(router({
    '/import': async (options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (body.dryRun) return response(planOf([entry({ name: 'drop', action: 'delete' })]));
      return response({ plan: planOf([]).plan, applied: true });
    },
  }));
  const dialog = openDialog(app);
  let tree = dialog.render();
  buttonByText(tree, 'Preview').props.onClick();
  await settle();
  tree = dialog.render();
  nodes(tree).find((node) => node.props.className === 'mm_btn primary').props.onClick();
  tree = dialog.render();
  assert.match(text(tree), /1 server\(s\) will be deleted/);
  assert.equal(requests.length, 1, 'nothing is applied before the confirmation');
  buttonByText(tree, 'Apply anyway').props.onClick();
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].dryRun, false);
});

it('offers Edit as JSON on a card and locks the dialog to that server', async () => {
  const app = await openList(router());
  const tree = app.render();
  const row = componentOf(tree, (node) => node.props.server?.name === 'github');
  assert.ok(row, 'the card is mounted');
  assert.equal(typeof row.props.onEditJson, 'function', 'the card wires the action');

  app.reset();
  const card = app.render(row.type, { ...row.props, open: true });
  assert.ok(buttonByText(card, 'Edit as JSON'), 'the card action is rendered beside Edit');

  const fresh = await openList(router());
  componentOf(fresh.render(), (node) => node.props.server?.name === 'github').props.onEditJson();
  const pageTree = fresh.render();
  const node = componentOf(pageTree, (candidate) => typeof candidate.props.onApplied === 'function' && candidate.props.mode);
  assert.equal(node.props.lockedName, 'github');
  assert.equal(node.props.scope, 'global');
  assert.deepEqual(Object.keys(node.props.seed.mcpServers), ['github']);
  fresh.reset();
  const dialog = fresh.render(node.type, { ...node.props, onClose() {}, onApplied() {} });
  assert.match(text(dialog), /Edit as JSON · github/);
  assert.match(text(dialog), /Scope fixed to Global/);
});

it('discards a preview when the target scope changes', async () => {
  const requests = [];
  const app = await openList(router({
    '/import': async (options) => {
      requests.push(JSON.parse(options.body));
      return response(planOf([entry({ name: 'drop', action: 'delete' })]));
    },
  }));
  const dialog = openDialog(app);
  let tree = dialog.render();
  buttonByText(tree, 'Preview').props.onClick();
  await settle();
  tree = dialog.render();
  assert.ok(nodes(tree).find((node) => node.props.className === 'mm_btn primary' && !node.props.disabled), 'the preview enables apply');

  // Switching the scope invalidates the plan: nothing is applied to a scope the
  // operator never previewed, and the apply button goes away.
  const scopeSelect = nodes(tree).find((node) => node.type === 'select' && node.props['aria-label'] === 'Scope');
  scopeSelect.props.onChange({ target: { value: 'workspace' } });
  tree = dialog.render();
  const apply = nodes(tree).find((node) => node.props.className === 'mm_btn primary');
  assert.equal(apply.props.disabled, true);
  assert.equal(requests.length, 1, 'no request was sent for the new scope');
  assert.doesNotMatch(text(tree), /will be deleted/);
});

it('previews automatically after a short delay when the dialog opens', async () => {
  const timers = [];
  let previews = 0;
  const app = mountClient(router({
    '/import': async () => { previews += 1; return response(planOf([entry({ name: 'github', action: 'unchanged' })])); },
  }), 'en', { setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {} });
  app.render();
  byLabel(app.render(), 'More actions').props.onClick({ stopPropagation() {} });
  allByClass(app.render(), 'mm_menuItem').find((item) => text(item) === 'Edit JSON').props.onClick();
  const node = componentOf(app.render(), (candidate) => typeof candidate.props.onApplied === 'function' && candidate.props.mode);
  app.reset();
  const props = { ...node.props, onApplied() {}, onClose() {} };
  const tree = app.render(node.type, props);
  assert.match(text(tree), /Apply/, 'the idle apply label carries no count');

  app.effects();
  assert.equal(timers.length, 1, 'opening the dialog schedules one debounced preview');
  assert.equal(previews, 0, 'nothing is requested before the delay');
  timers[0]();
  await settle();
  assert.equal(previews, 1, 'the debounce previews the document without a click');
  assert.match(text(app.render(node.type, props)), /Unchanged github/);
});

it('editing the document invalidates the plan and the next preview enables apply', async () => {
  let call = 0;
  const app = await openList(router({
    '/import': async () => {
      call += 1;
      return response(call === 1
        ? planOf([entry({ name: 'github', action: 'unchanged' })])
        : planOf([entry({ name: 'github', action: 'update', changes: [{ field: 'url', from: 'https://api.github.com/mcp', to: 'https://api.github.com/v2' }] })]));
    },
  }));
  const dialog = openDialog(app);
  let tree = dialog.render();
  buttonByText(tree, 'Preview').props.onClick();
  await settle();
  tree = dialog.render();
  assert.equal(nodes(tree).find((node) => node.props.className === 'mm_btn primary').props.disabled, true);
  assert.match(text(nodes(tree).find((node) => node.props.className === 'mm_btn primary')), /Apply 0/);

  // Editing drops the stale plan and shows the neutral label, never an
  // "Apply 0" that looks like a computed result.
  const textarea = nodes(tree).find((node) => node.props.className === 'mm_jsonText');
  textarea.props.onChange({ target: { value: '{"mcpServers":{"github":{"type":"http","url":"https://api.github.com/v2","authMode":"oauth"}}}' } });
  tree = dialog.render();
  const idle = nodes(tree).find((node) => node.props.className === 'mm_btn primary');
  assert.equal(idle.props.disabled, true);
  assert.equal(text(idle), 'Apply');

  buttonByText(tree, 'Preview').props.onClick();
  await settle();
  tree = dialog.render();
  const apply = nodes(tree).find((node) => node.props.className === 'mm_btn primary');
  assert.equal(apply.props.disabled, false);
  assert.match(text(apply), /Apply 1/);
});

it('ignores a preview response that a newer request superseded', async () => {
  const pending = [];
  const app = await openList(router({
    '/import': () => new Promise((resolve) => { pending.push(resolve); }),
  }));
  const dialog = openDialog(app);
  let tree = dialog.render();
  buttonByText(tree, 'Preview').props.onClick();
  buttonByText(tree, 'Preview').props.onClick();
  await settle();
  assert.equal(pending.length, 2);

  pending[1](response(planOf([entry({ name: 'second', action: 'new' })])));
  await settle();
  tree = dialog.render();
  assert.match(text(tree), /New second/);

  pending[0](response(planOf([entry({ name: 'first', action: 'new' })])));
  await settle();
  tree = dialog.render();
  assert.match(text(tree), /New second/);
  assert.doesNotMatch(text(tree), /New first/);
});

it('keeps the conflict choices while the document is edited', async () => {
  let call = 0;
  const app = await openList(router({
    '/import': async () => {
      call += 1;
      return response(planOf([
        entry({ name: 'shared', action: 'conflict', conflict: { scope: 'global', path: null, enabled: true } }),
      ]));
    },
  }));
  const dialog = openDialog(app);
  let tree = dialog.render();
  buttonByText(tree, 'Preview').props.onClick();
  await settle();
  tree = dialog.render();
  nodes(tree).filter((node) => node.props.type === 'radio')[1].props.onChange();
  tree = dialog.render();
  assert.equal(nodes(tree).find((node) => node.props.className === 'mm_btn primary').props.disabled, false);

  const textarea = nodes(tree).find((node) => node.props.className === 'mm_jsonText');
  textarea.props.onChange({ target: { value: textarea.props.value.replace('api.github.com', 'api.github.com') } });
  tree = dialog.render();
  assert.equal(call, 1, 'no request was sent by the edit itself');
  buttonByText(tree, 'Preview').props.onClick();
  await settle();
  tree = dialog.render();
  assert.equal(call, 2);
  assert.equal(nodes(tree).find((node) => node.props.className === 'mm_btn primary').props.disabled, false,
    'the replace choice survived the edit');
});

it('localizes the menu and the dialog in both languages', async () => {
  const app = await openList(router());
  let tree = app.render();
  byLabel(tree, 'More actions').props.onClick({ stopPropagation() {} });
  tree = app.render();
  assert.deepEqual(allByClass(tree, 'mm_menuItem').map((item) => text(item)), ['Edit JSON', 'Import JSON']);
  app.setLocale('zh');
  tree = app.render();
  assert.deepEqual(allByClass(tree, 'mm_menuItem').map((item) => text(item)), ['编辑 JSON', '导入 JSON']);
  const dictionaries = app.dictionaries;
  assert.deepEqual(Object.keys(dictionaries.zh).sort(), Object.keys(dictionaries.en).sort());
});
