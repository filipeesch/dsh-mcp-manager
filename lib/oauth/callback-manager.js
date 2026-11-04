/**
 * Owns the loopback HTTP listeners that receive OAuth callbacks.
 *
 * The manager knows nothing about MCP connections, tokens or the DSH web
 * interface: `acquire()` returns the absolute redirect URI for a path and a
 * `release()` that frees it, and every request on that path is handed to the
 * caller's `onRequest`. A listener is a set of sockets sharing one port, so
 * `localhost` can answer on both loopback families while different servers can
 * share a port through different paths.
 */

import { createServer } from 'node:http';
import { buildRedirectUri, normalizeCallbackPath, optionalAddresses, requiredAddresses } from './redirect-resolver.js';
import { sendCallbackPage } from './callback-page.js';

function bindError(address, port, cause) {
  const code = typeof cause?.code === 'string' ? cause.code : '';
  const where = port ? `${address}:${port}` : address;
  let reason = String(cause?.message ?? cause ?? 'unknown error');
  if (code === 'EADDRINUSE') {
    reason = `port ${port ?? '?'} is already in use (another DSH instance or another application holds it)`;
  } else if (code === 'EACCES') {
    reason = `permission denied while binding ${where}`;
  } else if (code === 'EADDRNOTAVAIL') {
    reason = `${address} is not an address this machine can bind`;
  }
  const error = new Error(`cannot open the OAuth callback listener at ${where}: ${reason}`);
  error.code = code;
  error.port = port ? String(port) : '';
  error.address = address;
  error.cause = cause;
  return error;
}

function listenOn(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address());
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host, port });
  });
}

function closeServer(server, { force = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    // A keep-alive connection would otherwise hold the port until its timeout.
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, 2000);
    timer.unref?.();
    try {
      server.close(() => finish());
    } catch {
      finish();
    }
    if (force) server.closeAllConnections?.();
  });
}

/**
 * @param {{ onError?: (error: unknown) => void }} [options]
 */
export function createCallbackManager({ onError } = {}) {
  /** @type {Map<string, object>} keyed by the listener's port */
  const listeners = new Map();

  async function createAndListen(listener, address, port) {
    const server = createServer((req, res) => {
      void handleRequest(listener, req, res);
    });
    const assigned = await listenOn(server, address, port);
    return { server, port: String(assigned.port) };
  }

  async function handleRequest(listener, req, res) {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      sendCallbackPage(res, 400, { ok: false, message: 'The callback request could not be read.' });
      return;
    }
    if (req.method !== 'GET') {
      sendCallbackPage(res, 405, { ok: false, message: 'This address only accepts a GET callback.' });
      return;
    }
    const route = listener.paths.get(url.pathname);
    if (!route) {
      sendCallbackPage(res, 404, { ok: false, message: 'No OAuth authorization is pending for this callback address.' });
      return;
    }
    try {
      await route.handler({ req, res, url, path: url.pathname });
    } catch (error) {
      onError?.(error);
      if (!res.headersSent) {
        sendCallbackPage(res, 500, { ok: false, message: 'The callback could not be processed.' });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  }

  async function openListener({ addresses, optional = [], port = '', auto = false }) {
    const listener = { port: '', auto, addresses: new Map(), paths: new Map(), refs: 0, closed: false };
    let primary = null;
    let lastError = null;
    for (const address of addresses) {
      try {
        const bound = await createAndListen(listener, address, port ? Number(port) : 0);
        primary = { address, ...bound };
        break;
      } catch (error) {
        lastError = error;
        if (!optional.includes(address)) throw bindError(address, port, error);
      }
    }
    if (!primary) throw bindError(addresses[0], port, lastError);
    listener.port = primary.port;
    listener.addresses.set(primary.address, primary.server);
    for (const address of addresses) {
      if (address === primary.address) continue;
      try {
        const extra = await createAndListen(listener, address, Number(listener.port));
        listener.addresses.set(address, extra.server);
      } catch (error) {
        if (!optional.includes(address)) {
          await closeListener(listener, { force: true });
          throw bindError(address, listener.port, error);
        }
      }
    }
    listeners.set(listener.port, listener);
    return listener;
  }

  async function ensureAddresses(listener, addresses, optional) {
    for (const address of addresses) {
      if (listener.addresses.has(address)) continue;
      try {
        const { server } = await createAndListen(listener, address, Number(listener.port));
        listener.addresses.set(address, server);
      } catch (error) {
        if (!optional.includes(address)) throw bindError(address, listener.port, error);
      }
    }
  }

  async function findAutoListener(addresses, optional) {
    for (const listener of listeners.values()) {
      if (!listener.auto || listener.closed) continue;
      try {
        await ensureAddresses(listener, addresses, optional);
        return listener;
      } catch {
        // Not compatible (for example a different explicit address): try the
        // next automatic listener or allocate a new one.
      }
    }
    return null;
  }

  async function closeListener(listener, { force = false } = {}) {
    listener.closed = true;
    const servers = [...listener.addresses.values()];
    listener.addresses.clear();
    await Promise.all(servers.map((server) => closeServer(server, { force })));
  }

  async function releaseUsage({ port, path } = {}) {
    const listener = listeners.get(String(port ?? ''));
    if (!listener) return;
    const route = path === undefined ? null : listener.paths.get(path);
    if (route) {
      route.refs -= 1;
      if (route.refs <= 0) listener.paths.delete(path);
    }
    listener.refs = Math.max(0, listener.refs - 1);
    if (listener.refs > 0 || listener.paths.size > 0) return;
    listeners.delete(listener.port);
    await closeListener(listener);
  }

  return {
    /**
     * Bind (or reuse) a listener for one flow and register its path.
     * @returns {Promise<{ uri: string, port: string, path: string, release: () => Promise<void> }>}
     */
    async acquire({ host, port = '', path = '/callback', onRequest } = {}) {
      const normalizedPath = normalizeCallbackPath(path);
      const addresses = requiredAddresses(host);
      const optional = optionalAddresses(host);
      const fixedPort = port === undefined || port === null || port === '' ? '' : String(port);
      if (fixedPort && (!/^\d+$/.test(fixedPort) || Number(fixedPort) < 1 || Number(fixedPort) > 65535)) {
        throw new Error('callback port must be a number between 1 and 65535');
      }
      let listener;
      if (fixedPort) {
        listener = listeners.get(fixedPort) ?? null;
        if (listener) {
          await ensureAddresses(listener, addresses, optional);
        } else {
          listener = await openListener({ addresses, optional, port: fixedPort, auto: false });
        }
      } else {
        listener = await findAutoListener(addresses, optional)
          ?? await openListener({ addresses, optional, port: '', auto: true });
      }
      let route = listener.paths.get(normalizedPath);
      if (!route) {
        route = { refs: 0, handler: onRequest };
        listener.paths.set(normalizedPath, route);
      } else if (typeof onRequest === 'function' && route.handler !== onRequest) {
        route.handler = onRequest;
      }
      route.refs += 1;
      listener.refs += 1;
      const boundPort = listener.port;
      return {
        uri: buildRedirectUri({ host, port: boundPort, path: normalizedPath }),
        port: boundPort,
        path: normalizedPath,
        release: () => releaseUsage({ port: boundPort, path: normalizedPath }),
      };
    },

    /** Release one flow's use of a path; closes the listener when nothing is left. */
    release: releaseUsage,

    /** The listener list the interface reports, without leaking internals. */
    status() {
      return [...listeners.values()].map((listener) => ({
        port: Number(listener.port),
        addresses: [...listener.addresses.keys()],
        paths: [...listener.paths.keys()],
        pending: [...listener.paths.values()].reduce((total, route) => total + route.refs, 0),
      }));
    },

    /** Plugin teardown: close every socket and leave no bound port behind. */
    async closeAll() {
      const all = [...listeners.values()];
      listeners.clear();
      await Promise.all(all.map((listener) => closeListener(listener, { force: true })));
    },
  };
}
