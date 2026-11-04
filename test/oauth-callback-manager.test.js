/**
 * Callback listener pool (v0.18.0): one port per listener, several loopback
 * sockets per port, path routing, reference counting and a clean release.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { it } from 'node:test';

const { createCallbackManager } = await import('../lib/oauth/callback-manager.js');
const { canBindIPv6Loopback, canBindPort, freePort } = await import('./helpers/oauth-harness.js');

function handlerFor(label, seen) {
  return ({ req, res, url }) => {
    seen.push({ label, path: url.pathname, method: req.method });
    res.writeHead(200, { 'Content-Type': 'text/plain', Connection: 'close' });
    res.end(label);
  };
}

async function hit(uri) {
  const response = await fetch(uri);
  return { status: response.status, body: await response.text() };
}

it('binds an automatic listener and releases its port', async () => {
  const manager = createCallbackManager();
  const seen = [];
  const flow = await manager.acquire({ host: 'localhost', path: '/callback', onRequest: handlerFor('one', seen) });
  assert.match(flow.uri, /^http:\/\/localhost:\d+\/callback$/);
  assert.equal(flow.path, '/callback');
  const response = await hit(flow.uri);
  assert.equal(response.status, 200);
  assert.equal(response.body, 'one');
  assert.equal(seen.length, 1);
  assert.equal((await manager.status()).length, 1);

  await flow.release();
  assert.deepEqual(await manager.status(), []);
  assert.equal(await canBindPort(flow.port), true, 'the port is bindable again');
});

it('shares one automatic listener between flows and routes by path', async () => {
  const manager = createCallbackManager();
  const seen = [];
  const first = await manager.acquire({ host: 'localhost', path: '/callback', onRequest: handlerFor('first', seen) });
  const second = await manager.acquire({ host: 'localhost', path: '/gh', onRequest: handlerFor('second', seen) });
  assert.equal(second.port, first.port, 'a compatible flow reuses the same listener');
  assert.notEqual(second.uri, first.uri);

  assert.equal((await hit(first.uri)).body, 'first');
  assert.equal((await hit(second.uri)).body, 'second');
  assert.deepEqual(seen.map((entry) => entry.path), ['/callback', '/gh']);
  assert.equal((await manager.status())[0].pending, 2);

  await first.release();
  assert.equal((await manager.status()).length, 1, 'the listener stays while another flow needs it');
  assert.equal((await hit(second.uri)).body, 'second');
  await second.release();
  assert.deepEqual(await manager.status(), []);
});

it('answers an unregistered path with 404 and a non-GET method with 405', async () => {
  const manager = createCallbackManager();
  const flow = await manager.acquire({ host: 'localhost', path: '/callback', onRequest: handlerFor('one', []) });
  const unknown = await hit(`${new URL(flow.uri).origin}/nope`);
  assert.equal(unknown.status, 404);
  assert.match(unknown.body, /No OAuth authorization is pending/);

  const post = await fetch(flow.uri, { method: 'POST' });
  assert.equal(post.status, 405);
  await post.text();
  await flow.release();
});

it('reuses an explicitly configured fixed port', async () => {
  const manager = createCallbackManager();
  const seen = [];
  const first = await manager.acquire({ host: 'localhost', path: '/callback', onRequest: handlerFor('first', seen) });
  await first.release();

  const port = await freePort();
  const fixed = await manager.acquire({ host: '127.0.0.1', port, path: '/callback', onRequest: handlerFor('fixed', seen) });
  assert.equal(fixed.uri, `http://127.0.0.1:${port}/callback`);
  assert.equal((await hit(fixed.uri)).body, 'fixed');

  const again = await manager.acquire({ host: '127.0.0.1', port, path: '/callback', onRequest: handlerFor('fixed', seen) });
  assert.equal(again.port, fixed.port);
  assert.equal((await manager.status()).length, 1, 'the same port is one listener');
  await fixed.release();
  await again.release();
  assert.equal(await canBindPort(port), true);
});

it('fails a busy fixed port with an actionable error and no fallback', async () => {
  const holder = createServer();
  await new Promise((resolve) => holder.listen({ host: '127.0.0.1', port: 0 }, resolve));
  const port = holder.address().port;
  const manager = createCallbackManager();
  try {
    await assert.rejects(
      () => manager.acquire({ host: '127.0.0.1', port, path: '/callback', onRequest: () => {} }),
      (error) => {
        assert.equal(error.code, 'EADDRINUSE');
        assert.equal(error.port, String(port));
        assert.match(error.message, new RegExp(`port ${port} is already in use`));
        assert.ok(error.cause, 'the underlying socket error is kept for diagnostics');
        return true;
      },
    );
    assert.deepEqual(await manager.status(), [], 'no fallback listener is opened');
  } finally {
    await new Promise((resolve) => holder.close(resolve));
  }
});

it('runs separate listeners when different fixed ports are required', async () => {
  const firstPort = await freePort();
  const secondPort = await freePort();
  const manager = createCallbackManager();
  const first = await manager.acquire({ host: '127.0.0.1', port: firstPort, path: '/callback', onRequest: handlerFor('first', []) });
  const second = await manager.acquire({ host: '127.0.0.1', port: secondPort, path: '/callback', onRequest: handlerFor('second', []) });
  assert.equal((await manager.status()).length, 2);
  assert.equal((await hit(first.uri)).body, 'first');
  assert.equal((await hit(second.uri)).body, 'second');
  await manager.closeAll();
  assert.deepEqual(await manager.status(), []);
  assert.equal(await canBindPort(firstPort), true);
  assert.equal(await canBindPort(secondPort), true);
});

it('widens localhost to both loopback families when the host allows it', async (t) => {
  if (!(await canBindIPv6Loopback())) return t.skip('the IPv6 loopback is not available on this host');
  const manager = createCallbackManager();
  const flow = await manager.acquire({ host: 'localhost', path: '/callback', onRequest: handlerFor('v6', []) });
  const listener = (await manager.status())[0];
  assert.deepEqual(listener.addresses.sort(), ['127.0.0.1', '::1'].sort());
  assert.equal((await hit(flow.uri)).body, 'v6');
  await flow.release();
});

it('closes every socket on closeAll', async () => {
  const port = await freePort();
  const manager = createCallbackManager();
  await manager.acquire({ host: '127.0.0.1', port, path: '/callback', onRequest: handlerFor('one', []) });
  await manager.acquire({ host: '127.0.0.1', port, path: '/second', onRequest: handlerFor('two', []) });
  assert.equal((await manager.status())[0].pending, 2);
  await manager.closeAll();
  assert.deepEqual(await manager.status(), []);
  assert.equal(await canBindPort(port), true);
});

it('shares one listener when two acquisitions race for the same fixed port', async () => {
  const port = await freePort();
  const manager = createCallbackManager();
  const [first, second] = await Promise.all([
    manager.acquire({ host: '127.0.0.1', port, path: '/a', onRequest: handlerFor('a', []) }),
    manager.acquire({ host: '127.0.0.1', port, path: '/b', onRequest: handlerFor('b', []) }),
  ]);
  assert.equal(first.port, String(port));
  assert.equal(second.port, String(port));
  const status = await manager.status();
  assert.equal(status.length, 1, 'a concurrent bind must not report a self-inflicted EADDRINUSE');
  assert.deepEqual(status[0].paths.sort(), ['/a', '/b']);
  await first.release();
  await second.release();
  assert.equal(await canBindPort(port), true);
});

it('shares one listener when two automatic acquisitions race', async () => {
  const manager = createCallbackManager();
  const [first, second] = await Promise.all([
    manager.acquire({ host: 'localhost', path: '/a', onRequest: handlerFor('a', []) }),
    manager.acquire({ host: 'localhost', path: '/b', onRequest: handlerFor('b', []) }),
  ]);
  assert.equal(first.port, second.port);
  assert.equal((await manager.status()).length, 1);
  await first.release();
  await second.release();
});

it('ignores a duplicated or stale release instead of closing a re-created listener', async () => {
  const port = await freePort();
  const manager = createCallbackManager();
  const first = await manager.acquire({ host: '127.0.0.1', port, path: '/callback', onRequest: handlerFor('one', []) });
  await first.release();
  const second = await manager.acquire({ host: '127.0.0.1', port, path: '/callback', onRequest: handlerFor('two', []) });
  // A late release of the first acquisition must not touch the new listener.
  await first.release();
  await manager.release(first);
  assert.equal((await manager.status()).length, 1, 'the current flow keeps its listener');
  assert.equal((await hit(second.uri)).body, 'two');
  await second.release();
  assert.deepEqual(await manager.status(), []);
});
