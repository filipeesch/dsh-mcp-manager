import { randomBytes } from 'node:crypto';
import { formatRedirectOverride, parseRedirectOverride } from '../oauth/redirect-resolver.js';

/**
 * Pure server-configuration helpers shared by every write path.
 *
 * Nothing here performs I/O or reads plugin state, so an editor, a config
 * loader and the JSON importer can all normalize an entry with the same rules
 * instead of keeping three parsers in sync.
 */

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const HTTP_URL_PATTERN = /^https?:\/\//;

/** A validation failure that names the offending field. */
export function configError(field, message) {
  const error = new Error(message);
  error.field = field;
  return error;
}

export function isValidServerName(name) {
  return typeof name === 'string' && NAME_PATTERN.test(name);
}

/**
 * Normalize an env/header payload into a flat string→string map.
 * Accepts the current object form plus the legacy `[{ name, value }]` list
 * (older plugin versions wrote that) and `[{ key, value }]`. Entries without a
 * usable name are dropped; values are coerced to strings.
 */
export function normalizeEnvPairs(value) {
  if (Array.isArray(value)) {
    const out = {};
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const name = entry.name ?? entry.key;
      if (typeof name !== 'string' || !name) continue;
      out[name] = String(entry.value ?? '');
    }
    return out;
  }
  if (value && typeof value === 'object') return value;
  return {};
}

// Normalize an env payload (object, `[{name,value}]` list, or JSON string) into
// a flat string->string map.
export function parseEnv(env) {
  if (Array.isArray(env)) return parseEnv(normalizeEnvPairs(env));
  if (env && typeof env === 'object') {
    const out = {};
    for (const key of Object.keys(env)) out[key] = String(env[key] ?? '');
    return out;
  }
  if (typeof env === 'string' && env.trim()) {
    try {
      const parsed = JSON.parse(env);
      if (parsed && typeof parsed === 'object') return parseEnv(parsed);
    } catch {}
  }
  return {};
}

// Tokenize a command-line args string (respecting double/single quotes) into an
// argv array.
export function parseArgs(args) {
  if (Array.isArray(args)) return args.filter((item) => typeof item === 'string');
  if (typeof args === 'string') {
    const out = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match;
    while ((match = re.exec(args))) out.push(match[1] ?? match[2] ?? match[3]);
    return out;
  }
  return [];
}

export function normalizeTimeout(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout >= 1000 ? Math.floor(timeout) : undefined;
}

export function applyTimeout(server, value) {
  const timeout = normalizeTimeout(value);
  if (timeout === undefined) delete server.timeout;
  else server.timeout = timeout;
}

// HTTP auth modes: oauth | static | none. Unknown or legacy values fall back
// to oauth so a hand-edited config can never leave a server in a limbo state.
export function normalizeAuthMode(value) {
  return value === 'static' || value === 'none' ? value : 'oauth';
}

// A manually configured client id means the user registered an app with the
// provider themselves; dynamic client registration is skipped entirely and the
// redirect URI must already be whitelisted there.
export function manualClientId(server) {
  return typeof server.clientId === 'string' ? server.clientId.trim() : '';
}

// The `client_name` a dynamic registration (RFC 7591) advertises. It is
// optional because some providers only accept the name of a client they
// registered themselves; the default stays a stable plugin identity and the
// plugin never substitutes another product's name on its own.
export function defaultClientName(server) {
  return `dsh-mcp-manager-${server.name}`;
}

export function clientNameOf(server) {
  const configured = typeof server.clientName === 'string' ? server.clientName.trim() : '';
  return configured || defaultClientName(server);
}

// The client name participates in cached-state invalidation only for a
// dynamically registered client: a manually configured Client ID never
// registers, so editing the field must not log that server out.
export function registrationNameKey(server) {
  return manualClientId(server) ? '' : clientNameOf(server);
}

/**
 * The authorization-server issuer a stored session belongs to. Pure: the
 * discovery caches on `server.oauth` are read, never written, and the MCP
 * endpoint origin is the last resort.
 */
export function issuerOf(server) {
  if (server?.oauth?.authorizationServer) return String(server.oauth.authorizationServer).replace(/\/$/, '');
  if (server?.oauth?.issuer) return server.oauth.issuer.replace(/\/$/, '');
  return originOf(server?.url);
}

export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * Whether a stored OAuth registration and its tokens may survive an edit.
 *
 * Every component here describes the client the token was issued to: the
 * endpoint origin (audience), the manual client id, the secret source, the
 * dynamic client name, and the authorization server. The redirect URI is
 * deliberately absent — changing it re-registers lazily on the next
 * authentication and must not sign the server out.
 */
export function sameAuthIdentity(a, b) {
  const key = (server) => JSON.stringify([
    originOf(server?.url),
    manualClientId(server),
    String(server?.clientSecretEnv ?? '').trim(),
    registrationNameKey(server),
    issuerOf(server),
  ]);
  return key(a) === key(b);
}

/**
 * Validate the optional OAuth credential fields shared by the global and
 * workspace editors. Pure (no I/O), so callers can validate before mutating.
 */
export function parseOauthFields(input, current = {}) {
  const clientId = String(input.clientId ?? current.clientId ?? '').trim();
  if (clientId.length > 512) throw configError('clientId', 'clientId must be at most 512 characters');
  const clientSecretEnv = String(input.clientSecretEnv ?? current.clientSecretEnv ?? '').trim();
  if (clientSecretEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(clientSecretEnv)) {
    throw configError('clientSecretEnv', 'clientSecretEnv must be the name of an environment variable (letters, digits, underscore), not the secret itself');
  }
  // The DCR `client_name`. Printable ASCII only: it is sent to a third party as
  // an opaque human-readable label, and control characters would make the
  // registration request malformed.
  const clientName = String(input.clientName ?? current.clientName ?? '').trim();
  if (clientName.length > 128) throw configError('clientName', 'clientName must be at most 128 characters');
  if (clientName && !/^[\x20-\x7E]+$/.test(clientName)) {
    throw configError('clientName', 'clientName must be printable ASCII (it is sent as client_name during dynamic client registration)');
  }
  const scope = String(input.scope ?? current.scope ?? '').trim();
  if (scope.length > 512) throw configError('scope', 'scope must be at most 512 characters');
  // A complete redirect URI: scheme://host[:port][/path]. An empty value keeps
  // the previous one, exactly like the other optional fields.
  let redirectParts;
  try {
    redirectParts = parseRedirectOverride(input.redirectUrl ?? current.redirectUrl ?? '');
  } catch (error) {
    throw configError('redirectUrl', error?.message ?? String(error));
  }
  const redirectUrl = formatRedirectOverride(redirectParts);
  return { clientId, clientSecretEnv, clientName, scope, redirectUrl };
}

// Copy the optional OAuth client-credential fields onto a server object,
// dropping keys that are empty so the persisted JSON stays minimal.
export function applyOauthFields(server, fields) {
  if (fields.clientId) server.clientId = fields.clientId; else delete server.clientId;
  if (fields.clientSecretEnv) server.clientSecretEnv = fields.clientSecretEnv; else delete server.clientSecretEnv;
  if (fields.clientName) server.clientName = fields.clientName; else delete server.clientName;
  if (fields.scope) server.scope = fields.scope; else delete server.scope;
  if (fields.redirectUrl) server.redirectUrl = fields.redirectUrl; else delete server.redirectUrl;
}

/**
 * Build the canonical server configuration from a flat payload.
 *
 * One builder serves the add form, both editors and the JSON importer. The
 * returned `entry` uses exactly the field names the workspace declaration
 * accepts, so a caller only decides where to write it (a state row or a
 * `mcpServers[name]` value).
 *
 * `current` carries the stored configuration on an edit: an omitted OAuth
 * credential field inherits it, and so does an empty `tokenEnv`, because a
 * partial payload must not sign a server out or lose the name of its token.
 * Every other field is taken from the payload — the entry is a declaration, not
 * a patch. An explicit empty string still clears an OAuth field.
 *
 * `options.lenientOauth` swallows an invalid optional OAuth field instead of
 * throwing; the workspace loader uses it so one bad hand-edited field cannot
 * drop the whole server.
 */
export function buildServerEntry(input, current = null, options = {}) {
  const name = String(input?.name ?? current?.name ?? '').trim();
  if (!isValidServerName(name)) {
    throw configError('name', 'name must be 1-32 chars of [A-Za-z0-9_-] (it becomes the mcp__<name>__ tool prefix)');
  }
  const type = input?.type === 'stdio' ? 'stdio' : 'http';
  const entry = { type };
  applyTimeout(entry, input?.timeout);
  if (type === 'stdio') {
    const command = String(input?.command ?? '').trim();
    if (!command) throw configError('command', 'stdio server requires a command (executable, e.g. npx / uvx / python)');
    entry.command = command;
    entry.args = parseArgs(input?.args);
    entry.env = parseEnv(input?.env);
    const cwd = String(input?.cwd ?? '').trim();
    if (cwd) entry.cwd = cwd;
    return { name, entry };
  }
  const url = String(input?.url ?? '').trim();
  if (!HTTP_URL_PATTERN.test(url)) throw configError('url', 'url must be an http(s) URL');
  entry.url = url;
  entry.authMode = normalizeAuthMode(input?.authMode);
  entry.headers = parseEnv(input?.headers);
  entry.headerEnv = parseEnv(input?.headerEnv);
  if (entry.authMode === 'static') {
    // An omitted or empty name keeps the stored one: the edit form round-trips
    // it, and switching away from static is the explicit way to drop it.
    entry.tokenEnv = String(input?.tokenEnv ?? '').trim() || String(current?.tokenEnv ?? '').trim();
  } else if (entry.authMode === 'oauth') {
    try {
      const fields = parseOauthFields(input ?? {}, current ?? {});
      if (fields.clientId) entry.clientId = fields.clientId;
      if (fields.clientSecretEnv) entry.clientSecretEnv = fields.clientSecretEnv;
      if (fields.clientName) entry.clientName = fields.clientName;
      if (fields.scope) entry.scope = fields.scope;
      if (fields.redirectUrl) entry.redirectUrl = fields.redirectUrl;
    } catch (error) {
      if (!options.lenientOauth) throw error;
    }
  }
  return { name, entry };
}

/**
 * Normalize + validate a flat server payload (from the Settings form) into a
 * Claude/Codex-style `mcpServers[name]` entry. Returns `{ name, entry }` or
 * `{ error, field }`.
 */
export function buildWorkspaceEntry(body, current = null) {
  try {
    return buildServerEntry(body, current);
  } catch (error) {
    return { error: error?.message ?? String(error), field: error?.field ?? null };
  }
}

/**
 * Normalize one `mcpServers[name]` declaration into a live server object, or
 * null when it is unusable. Lenient by design: a hand-edited file must keep
 * loading even when one optional field is wrong.
 */
export function normalizeWorkspaceServer(name, cfg, cwd) {
  if (!isValidServerName(name)) return null;
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null;
  let built;
  try {
    built = buildServerEntry({ ...cfg, name }, null, { lenientOauth: true });
  } catch {
    return null;
  }
  const server = { id: `ws-${randomBytes(8).toString('base64url')}`, name, ...built.entry };
  if (server.type === 'stdio') server.cwd = built.entry.cwd || cwd;
  return server;
}

// Compare the configuration a server would connect with. Field order is fixed
// so a rescan can decide "nothing changed" without touching the connection.
export function sameServerConfig(a, b) {
  const norm = (s) => JSON.stringify({
    type: s.type ?? 'http',
    timeout: normalizeTimeout(s.timeout),
    url: s.url ?? '',
    authMode: s.authMode ?? '',
    tokenEnv: s.tokenEnv ?? '',
    clientId: s.clientId ?? '',
    clientSecretEnv: s.clientSecretEnv ?? '',
    clientName: s.clientName ?? '',
    scope: s.scope ?? '',
    redirectUrl: s.redirectUrl ?? '',
    headers: s.headers ?? {},
    headerEnv: s.headerEnv ?? {},
    command: s.command ?? '',
    args: s.args ?? [],
    env: s.env ?? {},
    cwd: s.cwd ?? '',
  });
  return norm(a) === norm(b);
}

// Fields a stored profile row takes from the normalized entry. `id`, `name`,
// `enabled`, `oauth` and `staticToken` are state, not configuration, and keys
// this plugin does not know are left alone — a hand-edited row keeps them.
const ROW_CONFIG_FIELDS = [
  'type', 'url', 'authMode', 'tokenEnv', 'headers', 'headerEnv',
  'clientId', 'clientSecretEnv', 'clientName', 'scope', 'redirectUrl',
  'timeout', 'command', 'args', 'env', 'cwd',
];

/** Apply a normalized entry onto an existing profile row in place. */
export function patchServerRow(row, entry) {
  for (const field of ROW_CONFIG_FIELDS) {
    if (entry[field] === undefined) delete row[field];
    else row[field] = entry[field];
  }
  // A legacy plaintext token is never kept: either an env var name supersedes
  // it, or the server is no longer static.
  delete row.staticToken;
  return row;
}

/**
 * Whether the stored OAuth registration and tokens survive this entry.
 *
 * The comparison runs against the row this entry would produce — not a plain
 * merge — because the applier removes every field the entry omits. Otherwise an
 * explicit `""` that clears the client identity would be invisible here while
 * the patch really deletes it, and the tokens of a client that just changed
 * would be kept. A discovery cache that already names the authorization server
 * is present on both sides, so only the endpoint origin, the client identity
 * and the issuer decide the outcome.
 */
export function keepsStoredSession(row, entry, name = row?.name) {
  if ((row?.type ?? 'http') !== 'http' || row?.authMode !== 'oauth') return false;
  if ((entry?.type ?? 'http') !== 'http' || entry?.authMode !== 'oauth') return false;
  const before = { ...row };
  const after = patchServerRow(structuredClone(before), entry);
  after.name = name;
  return sameAuthIdentity(before, after);
}
