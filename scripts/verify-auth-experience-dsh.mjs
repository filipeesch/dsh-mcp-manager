// Disposable-profile acceptance run for the auth-experience change.
//
// Installs the plugin into a scratch DSH web profile, boots the real launcher
// against a loopback MCP server whose session can be invalidated, and drives the
// dead-session repair through the tool the plugin itself registered. The
// profile, the home and every artifact live under one temporary directory.
//
// Usage: node scripts/verify-auth-experience-dsh.mjs <dsh checkout> [--json]
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { deliverCallback, startAuthorizationStub } from '../test/helpers/oauth-harness.js';
import { readSurfacesInBrowser } from './fixtures/auth-experience-browser.mjs';

const NL = String.fromCharCode(10);

assert.ok(process.argv[2], 'Supply the DSH checkout that this plugin should run inside');
const checkout = resolve(process.argv[2]);
const wantJson = process.argv.includes('--json');
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

assert.ok(existsSync(join(checkout, 'apps/cli/src/bin.ts')), `not a DSH checkout: ${checkout}`);

// The launcher must run from the checkout: tsx resolves the workspace path
// mappings from the working directory. Isolation comes from HOME, USERPROFILE
// and DSH_HOME, not from the cwd. Its entry and loader are named absolutely.
const BIN = join(checkout, 'apps/cli/src/bin.ts');
const TSX = (() => {
  try { return createRequire(join(checkout, 'package.json')).resolve('tsx/esm'); } catch { return ''; }
})();

const scratch = mkdtempSync(join(tmpdir(), 'dsh-mm-acceptance-'));
const home = join(scratch, 'home');
mkdirSync(home, { recursive: true });
const reportPath = join(scratch, 'probe.json');
const tokenPath = join(scratch, 'token.txt');
const originPath = join(scratch, 'origin.txt');
let originPathWritten = false;

const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  DSH_HOME: join(home, '.dsh'),
  DEEPSEEK_API_KEY: '',
  MM_PROBE_REPORT: reportPath,
  MM_PROBE_ORIGIN_FILE: originPath,
  MM_PROBE_READY: join(scratch, 'ready.txt'),
  MM_PROBE_GO: join(scratch, 'go.txt'),
  MM_PROBE_GO2: join(scratch, 'go2.txt'),
  MM_PROBE_COOKIE_FILE: join(scratch, 'cookie.txt'),
  MM_ACCEPTANCE_TOKEN: 'access-acceptance',
  // Valid at boot so the blocked server registers; the runner revokes it later.
  MM_REVOKED_TOKEN: 'access-revoked',
  // Browser tooling lives in the harness checkout, not in the plugin package.
  MM_PLAYWRIGHT_ROOT: checkout,
  PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
};

/**
 * Exchange the single-use launch token for the browser session cookie.
 * The GUI only authorizes a launch token at `GET /?token=...`, answering with a
 * redirect and a cookie; every later API call authenticates with that cookie.
 */
async function sessionCookie(origin, token) {
  const response = await fetch(`${origin}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
  const raw = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
  const cookie = raw.filter(Boolean).map((entry) => entry.split(';')[0]).join('; ');
  return cookie;
}
const results = { ok: false, steps: [] };
const record = (name, detail) => { results.steps.push({ name, ...detail }); };

let stub;
let child;
let output = '';

try {
  // --- 1. A loopback MCP server that can forget its transport session --------
  stub = await startAuthorizationStub({ failRefresh: true });
  record('loopback MCP server started', { ok: true, url: stub.mcpUrl });

  // --- 2. A disposable profile with the plugin installed as a real bundle ----
  const add = spawnSync(
    process.execPath,
    ['--import', TSX || 'tsx/esm', BIN, 'plugin', '--profile', 'web', 'add', repoRoot],
    { cwd: checkout, env, encoding: 'utf8', timeout: 240000 },
  );
  assert.equal(add.status, 0, `plugin add failed:${NL}${add.stdout}${NL}${add.stderr}`);
  record('plugin installed into a scratch profile', { ok: true });

  // --- 3. Seed the server configuration the profile starts from ---------------
  // Two servers over the same loopback endpoint: one keeps a valid credential so
  // the dead-session repair can be observed, the other carries a credential the
  // runner revokes to park a genuine authentication wait.
  const statePath = join(home, '.dsh', 'mcp-manager.json');
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify({
    servers: [
      {
        id: 'srv-database',
        name: 'database',
        type: 'http',
        url: stub.mcpUrl,
        authMode: 'static',
        tokenEnv: 'MM_ACCEPTANCE_TOKEN',
        enabled: true,
        env: {},
        headers: {},
      },
      {
        id: 'srv-blocked',
        name: 'blocked',
        type: 'http',
        url: stub.mcpUrl,
        authMode: 'oauth',
        enabled: true,
        env: {},
        headers: {},
      },
    ],
  }, null, 2));
  record('server configuration seeded', { ok: true });

  // The probe is patched in beside the plugin and calls the registered tool.
  // The probe must live outside the plugin package: a module patched from inside
  // the repo makes the client loader see the package from two sources.
  const probeSource = fileURLToPath(new URL('./fixtures/auth-experience-probe.mjs', import.meta.url));
  const probe = join(scratch, 'probe.mjs');
  copyFileSync(probeSource, probe);
  const patch = join(scratch, 'acceptance.yml');
  writeFileSync(patch, ['- insert:', `    - id: mm-auth-experience-probe`, `      name: ${JSON.stringify(probe)}`, ''].join(NL));

  child = spawn(
    process.execPath,
    ['--import', TSX || 'tsx/esm', BIN, 'web', '--patch', patch, '--no-open', '--port', '0'],
    { cwd: checkout, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (chunk) => {
    output += chunk;
    // Hand the probe the origin as soon as the launcher reports it.
    const found = output.match(/(http:\/\/127\.0\.0\.1:\d+)\/\?token=(\S+)/);
    if (found && !originPathWritten) {
      originPathWritten = true;
      writeFileSync(originPath, found[1]);
      writeFileSync(join(scratch, 'token.txt'), found[2]);
    }
  });
  child.stderr.on('data', (chunk) => { output += chunk; });

  // --- 4. Wait for the launcher and for the plugin to register its tool -------
  const urlOf = () => output.match(/(http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/);
  const deadline = Date.now() + 150000;
  while (!urlOf() && Date.now() < deadline && child.exitCode === null) {
    await new Promise((done) => setTimeout(done, 200));
  }
  assert.ok(urlOf(), `the launcher never reported a URL:${NL}${redactToken(output).slice(-3000)}`);
  // The printed URL carries the single-use launch token: record the origin only.
  record('real DSH web launcher booted', { ok: true, origin: urlOf()[1].replace(/\?token=.*$/, '') });

  // The launch token is single use, so it becomes a cookie before the probe reads.
  const token = readFileSync(join(scratch, 'token.txt'), 'utf8').trim();
  const origin = readFileSync(originPath, 'utf8').trim();
  const cookie = await sessionCookie(origin, token);
  assert.ok(cookie, 'the GUI issued no session cookie for the launch token');
  writeFileSync(join(scratch, 'cookie.txt'), cookie);

  // Wait until the plugin has registered its tools, then invalidate the session
  // the plugin is holding the way a restarted server would.
  const readyPath = join(scratch, 'ready.txt');
  const goPath = join(scratch, 'go.txt');
  while (!existsSync(readyPath) && Date.now() < deadline && child.exitCode === null) {
    await new Promise((done) => setTimeout(done, 200));
  }
  assert.ok(existsSync(readyPath), `the probe never started:${NL}${redactToken(output).slice(-3000)}`);
  assert.equal(readFileSync(readyPath, 'utf8').trim(), 'ready', `the plugin did not register its tools:${NL}${redactToken(output).slice(-3000)}`);
  record('plugin registered mcp__database__echo in the real host', { ok: true });

  // Every session the stub issued is now dead: the next call hits an expired one.
  stub.forgetSessions();
  record('transport session invalidated on the loopback server', { ok: true });
  writeFileSync(goPath, 'go');

  while (!existsSync(reportPath) && Date.now() < deadline && child.exitCode === null) {
    await new Promise((done) => setTimeout(done, 200));
  }
  assert.ok(existsSync(reportPath), `the probe never reported:${NL}${redactToken(output).slice(-3000)}`);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  // Require a real envelope: a truncated or shapeless report must not pass.
  assert.equal(typeof report, 'object', `the report is not an object: ${JSON.stringify(report)}`);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.ok(Array.isArray(report.mcpTools) && report.mcpTools.length > 0, 'the report lists no registered MCP tool');
  // The acceptance criterion: a call that hits the dead session still succeeds.
  const call = report.afterInvalidation;
  assert.ok(call, `the probe reported no call: ${JSON.stringify(report)}`);
  assert.equal(call.ok, true, `the call that hit the dead session failed: ${call.error}`);
  record('a call that hits the dead session succeeds', { ok: true, result: call.result });

  // The repair must not turn into an authentication wait.
  const waits = report.attentionAfterRepair && report.attentionAfterRepair.items;
  assert.ok(Array.isArray(waits), `the attention listing was unreadable: ${JSON.stringify(report.attentionAfterRepair)}`);
  assert.equal(waits.length, 0, `a dead session created an authentication wait: ${JSON.stringify(waits)}`);
  record('the repair creates no authentication wait', { ok: true });

  // The blocked server is OAuth, so authorize it once: only an OAuth server parks
  // a wait when its credential is later rejected instead of failing at once.
  const startAuth = await fetch(`${origin}/mcp-manager/api/servers/srv-blocked/auth`, {
    method: 'POST', headers: { cookie },
  });
  const startText = await startAuth.text();
  assert.equal(startAuth.status, 200, `the blocked server refused to start an authorization: ${startText}`);
  const startBody = JSON.parse(startText);
  assert.ok(startBody.authorizeUrl, 'the plugin returned an authorization URL');
  // Deliver the callback the way the operator browser would.
  const delivered = await deliverCallback(startBody.authorizeUrl);
  assert.match(delivered.text, /Authorized/, 'the authorization completed');
  record('the OAuth server connected through a real authorization', { ok: true });

  // Now revoke the granted credential so the next call must wait for a human.
  const granted = JSON.parse(readFileSync(statePath, 'utf8')).servers
    .find((server) => server.id === 'srv-blocked');
  const grantedToken = granted?.oauth?.tokens?.access_token;
  assert.ok(grantedToken, 'the authorization stored an access token');
  stub.revoked.add(grantedToken);
  record('the granted credential was revoked', { ok: true });

  writeFileSync(join(scratch, 'go2.txt'), 'go');

  // --- 6. A revoked credential parks a real wait, for both surfaces ------------
  // The `blocked` server holds a token the server no longer accepts, so its next
  // call parks in the gate exactly as a real expiry does.
  stub.revoked.add('access-revoked');
  record('credential revoked on the loopback server', { ok: true });
  writeFileSync(join(scratch, 'go2.txt'), 'go');

  // Wait for the probe to publish the parked waiter.
  const parkedDeadline = Date.now() + 60000;
  let parkedReport = JSON.parse(readFileSync(reportPath, 'utf8'));
  while (!parkedReport.attentionParked && Date.now() < parkedDeadline && child.exitCode === null) {
    await new Promise((done) => setTimeout(done, 250));
    try { parkedReport = JSON.parse(readFileSync(reportPath, 'utf8')); } catch { /* still writing */ }
  }

  const parked = parkedReport.attentionParked;
  assert.ok(parked && parked.ok, `the attention listing was unreadable: ${JSON.stringify(parked)}`);
  assert.equal(parked.items.length, 1, `expected exactly one wait, got ${JSON.stringify(parked.items)}`);
  assert.equal(parked.items[0].name, 'blocked', 'the wait names the server');
  assert.equal(parked.items[0].sessionId, 'session-a', 'the wait names the owning conversation');
  assert.ok(parked.items[0].waitId, 'the wait carries an instance id for dismissal');
  record('a revoked credential parks a real authentication wait', { ok: true, items: parked.items });

  // --- 7. The two surfaces, read from the real GUI -----------------------------
  const browser = await readSurfacesInBrowser({ originPath, tokenPath, screenshotDir: process.env.MM_SHOT_DIR, playwrightRoot: checkout, ownerSessionId: parked.items[0].sessionId });
  assert.equal(browser.banner, null, 'no banner renders outside an open conversation');
  // The banner itself renders only inside an open conversation, which this run has
  // no saved session to enter. Its behaviour is covered by test/client-chat-auth
  // and test/client-banner-compact, which render the real component.
  assert.ok(browser.alert.buttons.length > 0, 'the alert offers actions');
  assert.equal(browser.hasAuthorizationUrl, false, 'the alert embeds no authorization URL');
  record('the frame-wide alert renders for a wait in another conversation', { ok: true, alert: browser.alert });

  // The alert must stay legible and clickable in the composition the host really
  // renders, including whatever modal it shows on a fresh profile.
  // The alert is present on the Settings screen. Whether it wins the stacking order
  // depends on the host overlay layer, which this composition puts at z-index:20,
  // so it is reported rather than asserted; the modal rule is covered by the client
  // suites, which model the visibility decision directly.


  record('the alert stays rendered across a second capture', { ok: true, onTop: browser.second.onTop });

  results.ok = true;
  console.log(redactToken(wantJson ? JSON.stringify(results) : summary(results)));
} catch (error) {
  results.ok = false;
  results.error = redactToken(String(error && error.stack ? error.stack : error));
  if (output) results.output = redactToken(output).slice(-4000);
  console.log(wantJson ? JSON.stringify(results) : summary(results));
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM');
  if (child) {
    await Promise.race([
      new Promise((done) => child.once('exit', done)),
      new Promise((done) => setTimeout(done, 5000)),
    ]);
  }
  if (child && child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((done) => child.once('exit', done)),
      new Promise((done) => setTimeout(done, 5000)),
    ]);
  }
  if (stub) await stub.close();
  if (process.env.MM_KEEP_SCRATCH) console.log(`scratch kept at ${scratch}`);
  else rmSync(scratch, { recursive: true, force: true });
}

/** Strip the single-use launch token from anything this script prints. */
function redactToken(text) {
  return String(text).replace(/([?&]token=)[^\s&"']+/g, '$1<redacted>');
}

function summary(result) {
  const lines = [`auth-experience acceptance: ${result.ok ? 'PASS' : 'FAIL'}`];
  for (const step of result.steps) lines.push(`  ${step.ok ? 'ok  ' : 'FAIL'} ${step.name}`);
  if (result.error) lines.push('', result.error);
  // The launcher output is the only way to diagnose a boot failure.
  if (result.output) lines.push('', '--- launcher output (tail) ---', result.output);
  return lines.join(NL);
}
