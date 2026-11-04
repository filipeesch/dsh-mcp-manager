/**
 * Redirect resolution (v0.18.0): the pure policy that decides which address the
 * callback listener binds and which absolute URI the provider sees.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';

const {
  buildRedirectUri,
  formatHostForUrl,
  formatRedirectOverride,
  isLoopbackHostname,
  isLoopbackUrl,
  normalizeCallbackPath,
  parseCallbackConfig,
  parseRedirectOverride,
  resolveRedirect,
} = await import('../lib/oauth/redirect-resolver.js');

const FIXED = { mode: 'fixed', host: 'localhost', port: '8787', path: '/callback' };
const AUTO = { mode: 'automatic', host: 'localhost', path: '/callback' };

it('recognizes every loopback literal and nothing else', () => {
  for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.9.9.9', '::1', '[::1]']) {
    assert.equal(isLoopbackHostname(host), true, `${host} is loopback`);
  }
  for (const host of ['mcp.example.com', '0.0.0.0', '192.168.1.10', '::', 'localhost.example.com', '127.0.0.256', '']) {
    assert.equal(isLoopbackHostname(host), false, `${host} is not loopback`);
  }
});

it('formats an IPv6 literal with brackets inside a URL', () => {
  assert.equal(formatHostForUrl('::1'), '[::1]');
  assert.equal(formatHostForUrl('[::1]'), '[::1]');
  assert.equal(formatHostForUrl('127.0.0.1'), '127.0.0.1');
  assert.equal(buildRedirectUri({ host: '::1', port: '8080', path: '/callback' }), 'http://[::1]:8080/callback');
  assert.throws(() => buildRedirectUri({ host: 'localhost', port: '', path: '/callback' }), /bound port/);
});

it('normalizes a callback path and rejects unusable ones', () => {
  assert.equal(normalizeCallbackPath('/callback'), '/callback');
  assert.equal(normalizeCallbackPath('//oauth//return//'), '/oauth/return');
  assert.equal(normalizeCallbackPath('/'), '/');
  for (const bad of ['', 'callback', '/a?x=1', '/a#frag', '/a\\b', '/a/../b', '/a/./b', '/a\u0000b']) {
    assert.throws(() => normalizeCallbackPath(bad), Error, `${JSON.stringify(bad)} must be rejected`);
  }
});

it('defaults the global callback configuration to automatic', () => {
  assert.deepEqual(parseCallbackConfig(undefined), { mode: 'automatic', host: 'localhost', port: '', path: '/callback' });
  assert.deepEqual(parseCallbackConfig({}), { mode: 'automatic', host: 'localhost', port: '', path: '/callback' });
  assert.deepEqual(parseCallbackConfig('nonsense'), { mode: 'automatic', host: 'localhost', port: '', path: '/callback' });
});

it('validates the global callback configuration', () => {
  assert.deepEqual(parseCallbackConfig(FIXED), { mode: 'fixed', host: 'localhost', port: '8787', path: '/callback' });
  assert.throws(() => parseCallbackConfig({ mode: 'fixed', host: 'localhost', path: '/callback' }), /requires a port/);
  assert.throws(() => parseCallbackConfig({ mode: 'fixed', host: 'mcp.example.com', port: '80' }), /loopback/);
  assert.throws(() => parseCallbackConfig({ mode: 'sometimes' }), /automatic or fixed/);
  assert.throws(() => parseCallbackConfig({ mode: 'fixed', host: 'localhost', port: '0' }), /between 1 and 65535/);
  assert.throws(() => parseCallbackConfig({ mode: 'fixed', host: 'localhost', port: '70000' }), /between 1 and 65535/);
  // Automatic mode never keeps a stale port: it always allocates.
  assert.equal(parseCallbackConfig({ mode: 'automatic', port: '8787' }).port, '');
});

it('accepts a complete redirect override and canonicalizes it', () => {
  assert.deepEqual(parseRedirectOverride('localhost'), { scheme: 'http', host: 'localhost', port: '', path: '' });
  assert.deepEqual(parseRedirectOverride('127.0.0.1:8080'), { scheme: 'http', host: '127.0.0.1', port: '8080', path: '' });
  assert.deepEqual(parseRedirectOverride('http://localhost:8080/gh-callback'), {
    scheme: 'http', host: 'localhost', port: '8080', path: '/gh-callback',
  });
  assert.deepEqual(parseRedirectOverride('http://[::1]/cb'), { scheme: 'http', host: '::1', port: '', path: '/cb' });
  assert.equal(parseRedirectOverride(''), null);
  assert.equal(parseRedirectOverride('   '), null);
  assert.equal(formatRedirectOverride(parseRedirectOverride('HTTP://LocalHost:8080//a//b')), 'http://localhost:8080/a/b');
  assert.equal(formatRedirectOverride(parseRedirectOverride('localhost')), 'http://localhost');
});

it('rejects an override that cannot be served', () => {
  assert.throws(() => parseRedirectOverride('https://localhost:8080/cb'), /only http:\/\/ is accepted/);
  assert.throws(() => parseRedirectOverride('https://mcp.example.com/callback'), /must be a loopback address/);
  assert.throws(() => parseRedirectOverride('mcp.example.com:8080'), /loopback/);
  assert.throws(() => parseRedirectOverride('http://localhost:8080/cb?x=1'), /query, fragment or credentials/);
  assert.throws(() => parseRedirectOverride('http://localhost:8080/cb#frag'), /query, fragment or credentials/);
  assert.throws(() => parseRedirectOverride('http://user:pass@localhost/cb'), /query, fragment or credentials/);
  assert.throws(() => parseRedirectOverride('ftp://localhost/cb'), /only http:\/\/ is accepted/);
  assert.throws(() => parseRedirectOverride('http://localhost:0/cb'), /between 1 and 65535/);
});

it('resolves automatic mode without a port and without a URI', () => {
  const resolved = resolveRedirect({ override: '', config: undefined });
  assert.deepEqual(resolved, { mode: 'automatic', host: 'localhost', port: '', path: '/callback', uri: '' });
});

it('resolves fixed mode to a complete URI', () => {
  assert.deepEqual(resolveRedirect({ override: '', config: FIXED }), {
    mode: 'fixed', host: 'localhost', port: '8787', path: '/callback', uri: 'http://localhost:8787/callback',
  });
});

it('lets an override beat the global configuration', () => {
  const resolved = resolveRedirect({ override: 'http://127.0.0.1:9000/gh', config: FIXED });
  assert.equal(resolved.mode, 'override');
  assert.equal(resolved.uri, 'http://127.0.0.1:9000/gh');
});

it('inherits the fixed port and path when the override omits them', () => {
  const inherited = resolveRedirect({ override: 'localhost', config: FIXED });
  assert.equal(inherited.port, '8787');
  assert.equal(inherited.path, '/callback');
  assert.equal(inherited.uri, 'http://localhost:8787/callback');

  const hostOnly = resolveRedirect({ override: '127.0.0.1', config: FIXED });
  assert.equal(hostOnly.uri, 'http://127.0.0.1:8787/callback');

  const pathOnly = resolveRedirect({ override: 'http://localhost/gh', config: FIXED });
  assert.equal(pathOnly.uri, 'http://localhost:8787/gh');
});

it('allocates automatically when an override omits its port in automatic mode', () => {
  const resolved = resolveRedirect({ override: 'localhost', config: AUTO });
  assert.equal(resolved.mode, 'override');
  assert.equal(resolved.port, '');
  assert.equal(resolved.path, '/callback');
  assert.equal(resolved.uri, '');
  assert.equal(resolveRedirect({ override: 'http://localhost/gh', config: AUTO }).path, '/gh');
});

it('keeps an explicit override port verbatim', () => {
  const resolved = resolveRedirect({ override: 'http://127.0.0.1:8080/provider', config: AUTO });
  assert.equal(resolved.uri, 'http://127.0.0.1:8080/provider');
});

it('never falls back from an unservable stored override', () => {
  assert.throws(() => resolveRedirect({ override: 'https://relay.example.com/callback', config: AUTO }), /relay\.example\.com\/callback cannot be served/);
  assert.throws(() => resolveRedirect({ override: 'relay.example.com', config: FIXED }), /loopback/);
});

it('classifies a redirect as loopback only when the listener could receive it', () => {
  assert.equal(isLoopbackUrl('http://localhost:8080/callback'), true);
  assert.equal(isLoopbackUrl('http://[::1]:8080/callback'), true);
  assert.equal(isLoopbackUrl('http://127.0.0.1:8080/callback'), true);
  assert.equal(isLoopbackUrl('https://localhost:8080/callback'), false);
  assert.equal(isLoopbackUrl('http://mcp.example.com/callback'), false);
  assert.equal(isLoopbackUrl('not a url'), false);
});
