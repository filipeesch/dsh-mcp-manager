/**
 * Opening the authorization URL in the default browser.
 *
 * The launcher is platform-specific and always best effort: the caller keeps the
 * URL, a failed launch is only logged, and a host reached over SSH never opens a
 * window on the wrong machine.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { it } from 'node:test';
import { createUrlOpener, isRemoteSession, resolveLauncher } from '../lib/browser/open-url.js';

function fakeSpawn(outcome = 'spawn') {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit(outcome, outcome === 'error' ? new Error('no browser') : undefined));
    return child;
  };
  return { spawn, calls };
}

it('maps each platform to its launcher', () => {
  assert.deepEqual(resolveLauncher('darwin', 'http://x/cb'), { command: 'open', args: ['http://x/cb'] });
  assert.deepEqual(resolveLauncher('win32', 'http://x/cb?a=1&b=2'), { command: 'rundll32', args: ['url.dll,FileProtocolHandler', 'http://x/cb?a=1&b=2'] });
  assert.deepEqual(resolveLauncher('linux', 'http://x/cb'), { command: 'xdg-open', args: ['http://x/cb'] });
});

it('detects an SSH session', () => {
  assert.equal(isRemoteSession({}), false);
  assert.equal(isRemoteSession({ SSH_CONNECTION: '1 2 3 4' }), true);
  assert.equal(isRemoteSession({ SSH_TTY: '/dev/ttys001' }), true);
});

it('launches the platform opener with the URL', async () => {
  const { spawn, calls } = fakeSpawn('spawn');
  const open = createUrlOpener({ spawn, platform: 'darwin', env: {} });
  assert.deepEqual(await open('http://127.0.0.1/callback?code=1'), { opened: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'open');
  assert.deepEqual(calls[0].args, ['http://127.0.0.1/callback?code=1']);
  assert.equal(calls[0].options.detached, true);
});

it('reports a failed launch without throwing', async () => {
  const warnings = [];
  const { spawn } = fakeSpawn('error');
  const open = createUrlOpener({ spawn, platform: 'linux', env: {}, logger: { warn: (line) => warnings.push(line) } });
  const result = await open('http://127.0.0.1/callback');
  assert.equal(result.opened, false);
  assert.equal(warnings.length, 1);
});

it('never launches over SSH', async () => {
  const { spawn, calls } = fakeSpawn('spawn');
  const open = createUrlOpener({ spawn, platform: 'darwin', env: { SSH_CONNECTION: '1 2 3 4' } });
  assert.deepEqual(await open('http://127.0.0.1/callback'), { opened: false, reason: 'remote' });
  assert.equal(calls.length, 0);
});
