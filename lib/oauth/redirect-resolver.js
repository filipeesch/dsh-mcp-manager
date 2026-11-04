/**
 * Redirect resolution for the OAuth callback.
 *
 * Pure policy: given the per-server override and the global callback
 * configuration, decide which address the callback listener must bind and which
 * absolute URI the authorization server will see. No I/O, no request context —
 * the same inputs always produce the same answer, which is what makes the
 * "never silently change a fixed URI" rule testable.
 */

export const DEFAULT_CALLBACK_HOST = 'localhost';
export const DEFAULT_CALLBACK_PATH = '/callback';
export const AUTOMATIC_MODE = 'automatic';
export const FIXED_MODE = 'fixed';
const MAX_REDIRECT_LENGTH = 512;
const MAX_PATH_LENGTH = 200;

/** `[::1]` -> `::1`, `localhost` -> `localhost`. */
function bareHost(host) {
  const text = String(host ?? '').trim();
  if (text.startsWith('[') && text.endsWith(']')) return text.slice(1, -1);
  return text;
}

/**
 * Loopback literals only: the callback listener can never bind anything else,
 * so a host that is not one of these would produce an unreachable URI.
 */
export function isLoopbackHostname(host) {
  const bare = bareHost(host).toLowerCase();
  if (bare === 'localhost' || bare === '::1') return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
  if (!match) return false;
  return match.slice(1).every((part) => Number(part) <= 255);
}

/**
 * Addresses a listener must bind to serve `host`. `localhost` needs both
 * families because the browser may resolve it either way; everything else is a
 * literal and binds exactly itself.
 */
export function requiredAddresses(host) {
  const bare = bareHost(host);
  if (bare.toLowerCase() === 'localhost') return ['127.0.0.1', '::1'];
  return [bare];
}

/** Addresses that may fail to bind without invalidating the URI. */
export function optionalAddresses(host) {
  return bareHost(host).toLowerCase() === 'localhost' ? ['::1'] : [];
}

/** Host as it must appear inside a URL (IPv6 literals need brackets). */
export function formatHostForUrl(host) {
  const bare = bareHost(host);
  return bare.includes(':') ? `[${bare}]` : bare;
}

/** Normalize a callback path; throws with a reason when it is not usable. */
export function normalizeCallbackPath(value) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error('callback path is required');
  if (text.length > MAX_PATH_LENGTH) throw new Error(`callback path must be at most ${MAX_PATH_LENGTH} characters`);
  if (!text.startsWith('/')) throw new Error(`callback path must start with "/" (got ${text})`);
  if (text.includes('?') || text.includes('#')) throw new Error('callback path must not contain a query or a fragment');
  if (text.includes('\\')) throw new Error('callback path must not contain a backslash');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new Error('callback path must not contain control characters');
  const segments = text.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('callback path must not contain "." or ".." segments');
  }
  return `/${segments.join('/')}`;
}

/**
 * Normalize the global callback configuration. Missing fields fall back to the
 * documented defaults, so an absent configuration means "automatic".
 */
export function parseCallbackConfig(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawMode = typeof raw.mode === 'string' ? raw.mode.trim().toLowerCase() : '';
  if (rawMode && rawMode !== AUTOMATIC_MODE && rawMode !== FIXED_MODE) {
    throw new Error(`callback mode must be ${AUTOMATIC_MODE} or ${FIXED_MODE}`);
  }
  const mode = rawMode === FIXED_MODE ? FIXED_MODE : AUTOMATIC_MODE;
  const host = bareHost(typeof raw.host === 'string' && raw.host.trim() ? raw.host : DEFAULT_CALLBACK_HOST);
  if (!isLoopbackHostname(host)) {
    throw new Error(`callback hostname ${host} must be a loopback address (localhost, 127.0.0.1, [::1])`);
  }
  const path = normalizeCallbackPath(raw.path ?? DEFAULT_CALLBACK_PATH);
  let port = '';
  const rawPort = raw.port === undefined || raw.port === null ? '' : String(raw.port).trim();
  if (rawPort) {
    if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
      throw new Error('callback port must be a number between 1 and 65535');
    }
    port = String(Number(rawPort));
  }
  if (mode === FIXED_MODE && !port) throw new Error('fixed callback mode requires a port');
  // Automatic mode always allocates: a stale port in the stored configuration
  // must not turn it into a hidden fixed port.
  return { mode, host, port: mode === FIXED_MODE ? port : '', path };
}

/**
 * Parse a per-server override: `scheme://host[:port][/path]`. Returns null for
 * an empty value. A value that cannot be served throws instead of falling back.
 */
export function parseRedirectOverride(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (raw.length > MAX_REDIRECT_LENGTH) {
    throw new Error(`redirectUrl must be at most ${MAX_REDIRECT_LENGTH} characters`);
  }
  const match = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\[[0-9A-Fa-f:.]+\]|[^:/?#@\s]+)(?::(\d{1,5}))?(\/[^?#\s]*)?$/i.exec(raw);
  if (!match) {
    throw new Error(`redirectUrl must be scheme://host[:port][/path] with no query, fragment or credentials (got ${raw})`);
  }
  const scheme = (match[1] ?? 'http').toLowerCase();
  if (scheme !== 'http') {
    throw new Error('redirectUrl must use http: the callback listener is served over plain HTTP');
  }
  const host = bareHost(match[2]);
  if (!isLoopbackHostname(host)) {
    throw new Error(`redirectUrl host ${host} must be a loopback address (localhost, 127.0.0.1, [::1])`);
  }
  let port = match[3] ?? '';
  if (port) {
    if (Number(port) < 1 || Number(port) > 65535) throw new Error('redirectUrl port must be between 1 and 65535');
    port = String(Number(port));
  }
  const path = match[4] ? normalizeCallbackPath(match[4]) : '';
  return { scheme, host, port, path };
}

/**
 * Resolve the callback for one authorization attempt.
 *
 * Precedence: per-server override -> global fixed configuration -> automatic
 * allocation. An override without a port inherits the fixed global port, and
 * without a path inherits the fixed global path; in automatic mode those fall
 * back to an allocated port and `/callback`. `uri` is empty when the port is
 * allocated, because only the listener knows it.
 */
export function resolveRedirect({ override, config } = {}) {
  const global = parseCallbackConfig(config);
  const parts = parseRedirectOverride(override);
  if (parts) {
    const port = parts.port || (global.mode === FIXED_MODE ? global.port : '');
    const path = parts.path || (global.mode === FIXED_MODE ? global.path : DEFAULT_CALLBACK_PATH);
    return {
      mode: 'override',
      host: parts.host,
      port,
      path,
      uri: port ? buildRedirectUri({ host: parts.host, port, path }) : '',
    };
  }
  if (global.mode === FIXED_MODE) {
    return {
      mode: 'fixed',
      host: global.host,
      port: global.port,
      path: global.path,
      uri: buildRedirectUri({ host: global.host, port: global.port, path: global.path }),
    };
  }
  return { mode: AUTOMATIC_MODE, host: global.host, port: '', path: global.path, uri: '' };
}

/** Canonical stored form of an override (scheme always http, port/path optional). */
export function formatRedirectOverride(parts) {
  if (!parts) return '';
  // Hostnames are case-insensitive; storing one spelling keeps the pending
  // comparison and the displayed value stable.
  const host = formatHostForUrl(parts.host).toLowerCase();
  const authority = `${host}${parts.port ? `:${parts.port}` : ''}`;
  return `http://${authority}${parts.path || ''}`;
}

/** Absolute redirect URI for a resolved callback that already has its port. */
export function buildRedirectUri({ host, port, path }) {
  if (!port) throw new Error('a redirect URI needs a bound port');
  return `http://${formatHostForUrl(host)}:${port}${path}`;
}

/** Whether a URL names a place this plugin can receive a callback at. */
export function isLoopbackUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'http:' && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}
