/**
 * Render the real client components to standalone HTML for screenshots.
 *
 * The component code and the injected stylesheet come from lib/client.js
 * itself; only the React runtime is the test stub, and the palette tokens are
 * copied from the design system so the dark theme is accurate.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { mountClient, response, settle } from '../test/helpers/client-harness.js';

const OUT = process.argv[2] ?? 'screenshots';
const DSH_CSS = '/Users/filipe.esch/projects/pessoal/private-dsh/packages/client/ui-theme/src/styles/design-platform.css';

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toHtml(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return esc(node);
  if (Array.isArray(node)) return node.map(toHtml).join('');
  if (typeof node.type === 'function') return toHtml(node.type(node.props));
  const props = node.props ?? {};
  const skip = new Set(['children', 'className']);
  const attrs = Object.keys(props)
    .filter((key) => !skip.has(key) && typeof props[key] !== 'function' && props[key] !== undefined && props[key] !== null && props[key] !== false)
    .map((key) => ' ' + key + '="' + esc(props[key]) + '"')
    .join('');
  const cls = props.className ? ' class="' + esc(props.className) + '"' : '';
  const children = (node.children ?? []).map(toHtml).join('');
  return '<' + node.type + cls + attrs + '>' + children + '</' + node.type + '>';
}

/** The whole design system, so both palettes and every alias token are present. */
function themeTokens() {
  return { all: readFileSync(DSH_CSS, 'utf8') };
}

function page({ title, body, css, tokens, dark }) {
  const nl = String.fromCharCode(10);
  return [
    '<!doctype html><meta charset="utf-8">',
    '<title>' + esc(title) + '</title>',
    '<style>' + tokens.all + '</style>',
    '<style>' + css + '</style>',
    '<style>body{margin:0;padding:28px;font-family:system-ui,sans-serif;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}</style>',
    dark ? '<body data-ds-dark-theme>' : '<body>',
    body,
    '</body>',
  ].join(nl);
}

function waits(count) {
  const names = ['database', 'backstage', 'observability', 'trino', 'atlassian'];
  const sessions = ['session-a', 'session-a', 'session-other', 'session-other', 'session-other'];
  return Array.from({ length: count }, (_, i) => ({
    serverId: 'srv-' + i,
    sessionId: sessions[i],
    scope: i === 1 ? 'workspace' : 'global',
    workspacePath: i === 1 ? '/repo' : '',
    name: names[i],
    reason: i === 2 ? 'insufficient scope (requires: feed:read)' : 'invalid_token',
    error: i === 2 ? 'insufficient scope (requires: feed:read): re-authenticate to grant access' : '',
    phase: 'needs-auth',
    pending: 1,
    remainingMs: 90000,
  }));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const tokens = themeTokens();
  const bannerApp = mountClient(async () => response({ items: waits(3) }), 'en');
  const banner = bannerApp.slot('conversation.input.dock');
  const renderBanner = () => bannerApp.render(banner, { t: bannerApp.t, sessionId: 'session-a' });
  renderBanner();
  bannerApp.effects();
  await settle();
  const bannerHtml = toHtml(renderBanner());
  const storage = { getItem: (key) => (key === 'dsh.sessions.current' ? JSON.stringify({ sessionId: 'session-current' }) : null) };
  const alertApp = mountClient(async () => response({ items: waits(5) }), 'en', { localStorage: storage });
  const alert = alertApp.slot('shell.overlay');
  const renderAlert = () => alertApp.render(alert, {
    t: alertApp.t,
    sessionTitles: { 'session-a': 'Trip planning', 'session-other': 'Payments incident' },
  });
  renderAlert();
  alertApp.effects();
  await settle();
  const alertHtml = toHtml(renderAlert());
  const css = bannerApp.css;
  const frame = '<div style="max-width:720px;margin:0 auto">';
  writeFileSync(join(OUT, 'banner-dark.html'), page({ title: 'Conversation banner (dark)', body: frame + bannerHtml + '</div>', css, tokens, dark: true }));
  writeFileSync(join(OUT, 'banner-light.html'), page({ title: 'Conversation banner (light)', body: frame + bannerHtml + '</div>', css, tokens, dark: false }));
  writeFileSync(join(OUT, 'alert-dark.html'), page({ title: 'Frame-wide alert (dark)', body: '<div style="position:relative;height:420px">' + alertHtml + '</div>', css, tokens, dark: true }));
  console.log(JSON.stringify({ ok: true, hasBanner: bannerHtml.length > 0, hasAlert: alertHtml.length > 0 }));
}

await main();
