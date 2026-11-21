/**
 * Pure MCP/OAuth protocol helpers shared by the plugin and its transports.
 *
 * Nothing here touches plugin state, the network or the filesystem, so the
 * module can be imported by any tier and unit-tested directly.
 */

/** Protocol revision this client requests during `initialize`. */
export const MCP_PROTOCOL_VERSION = '2025-03-26';

/** Smallest tool-call budget the plugin accepts, in milliseconds. */
export const MIN_TOOL_CALL_TIMEOUT_MS = 1000;

/** Default tool-call budget, used when neither the server nor the plugin sets one. */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60000;

/**
 * Normalize a tool-call timeout.
 * @param value - a finite number or numeric string expressed in milliseconds.
 * @returns the floored budget, or undefined when the value is absent or too small.
 */
export function normalizeTimeout(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < MIN_TOOL_CALL_TIMEOUT_MS) return undefined;
  return Math.floor(n);
}

/**
 * Resolve the tool-call budget for one server: server override, then plugin
 * configuration, then the default.
 * @param server - configuration row.
 * @param config - plugin configuration.
 * @returns the budget in milliseconds.
 */
export function resolveToolCallTimeout(server, config = {}) {
  return normalizeTimeout(server?.timeout)
    ?? normalizeTimeout(config?.toolCallTimeoutMs)
    ?? DEFAULT_TOOL_CALL_TIMEOUT_MS;
}

// Node clamps delays above 2^31-1 to 1ms; chain bounded timers instead.
/**
 * A cancellable timer that survives delays beyond the platform limit.
 * @param callback - runs once the whole delay elapsed.
 * @param timeoutMs - total delay in milliseconds.
 * @returns `cancel()` and `unref()`.
 */
export function rpcTimeout(callback, timeoutMs) {
  let timer;
  let unref = false;
  const schedule = () => {
    const delay = Math.min(timeoutMs, 2147483647);
    timeoutMs -= delay;
    timer = setTimeout(timeoutMs > 0 ? schedule : callback, delay);
    if (unref) timer.unref?.();
  };
  schedule();
  return {
    cancel() { clearTimeout(timer); },
    unref() { unref = true; timer.unref?.(); },
  };
}

/**
 * Parse an RFC 6750 `WWW-Authenticate: Bearer k="v", ...` challenge into a
 * lower-cased parameter map. Returns null when there is no Bearer challenge.
 * Quoted values may contain commas and escaped quotes; tokens may be bare.
 * @param header - raw header value.
 * @returns the parameter map, or null.
 */
export function parseBearerChallenge(header) {
  if (typeof header !== 'string' || !header) return null;
  const start = header.search(/(^|[\s,])Bearer(\s|$)/i);
  if (start < 0) return null;
  const rest = header.slice(start).replace(/^[\s,]*Bearer/i, '');
  const params = {};
  const re = /\s*,?\s*([A-Za-z0-9_.-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/gy;
  let match;
  while ((match = re.exec(rest)) !== null) {
    const key = match[1].toLowerCase();
    if (!(key in params)) params[key] = match[2] !== undefined ? match[2].replace(/\\(.)/g, '$1') : match[3];
  }
  return params;
}

/**
 * Normalize a space-delimited OAuth scope string (RFC 6749 section 3.3):
 * collapse whitespace, drop duplicates and characters outside the scope-token
 * grammar. Bounded so a hostile header cannot bloat the state file.
 * @param value - raw scope string.
 * @returns the normalized scope, or an empty string.
 */
export function cleanScope(value) {
  if (typeof value !== 'string') return '';
  const out = [];
  for (const token of value.split(/\s+/)) {
    if (!token || !/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(token) || out.includes(token)) continue;
    out.push(token);
  }
  const joined = out.join(' ');
  return joined.length > 512 ? '' : joined;
}

/**
 * `scopes_supported` (RFC 8414 / RFC 9728) as a clean list of scope tokens.
 * @param value - the advertised array.
 * @returns the clean tokens.
 */
export function scopeList(value) {
  if (!Array.isArray(value)) return [];
  return cleanScope(value.filter((item) => typeof item === 'string').join(' ')).split(' ').filter(Boolean);
}

/**
 * Report the protocol revision the server actually selected. `initialize` is
 * allowed to answer with a different revision than the one requested; surfacing
 * the mismatch keeps a downgrade visible instead of appearing later as odd tool
 * errors.
 * @param serverName - server the handshake belongs to.
 * @param initResult - the `initialize` result.
 * @param requested - revision this client asked for.
 * @returns `{ level, message }`, or null when the server named no revision.
 */
export function protocolVersionNotice(serverName, initResult, requested = MCP_PROTOCOL_VERSION) {
  const negotiated = initResult?.protocolVersion;
  if (typeof negotiated !== 'string' || !negotiated) return null;
  if (negotiated === requested) {
    return { level: 'info', message: `mcp-manager: ${serverName} protocol ${negotiated}` };
  }
  return { level: 'warn', message: `mcp-manager: ${serverName} requested protocol ${requested} but the server selected ${negotiated}` };
}
