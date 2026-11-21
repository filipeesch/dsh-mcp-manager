/**
 * HTTP transports for MCP servers.
 *
 * Two generations of MCP HTTP transport live here, and they are not
 * interchangeable:
 *
 *   Streamable HTTP : POST <url>        -> the JSON-RPC result is the POST body
 *   HTTP with SSE   : GET  <url>        -> a long-lived stream whose first
 *                                          `event: endpoint` frame advertises the
 *                                          POST target (`?sessionId=...`)
 *                     POST <endpoint>   -> 202 Accepted; the result arrives as an
 *                                          `event: message` frame on the stream
 *
 * The module owns wire behaviour only. Credentials, the attempt log, the
 * tool-call budget, metadata discovery, status classification and the reconnect
 * are injected ports, so nothing here reaches into plugin state and the same
 * code serves the global tier and every workspace tier.
 */

import { AuthRequiredError } from '../auth/recovery.js';
import {
  MCP_PROTOCOL_VERSION,
  cleanScope,
  parseBearerChallenge,
  protocolVersionNotice,
  resolveToolCallTimeout,
  rpcTimeout,
} from './protocol.js';

/**
/**
 * Whether a response says the server no longer recognises the transport session.
 *
 * Only a `404` or a `400` counts, and only when the server's own error message is a
 * statement about the *transport* session. An unknown tool called
 * `session_summary`, a field named `session_name`, an argument error naming
 * `sessionId` and a hint inside `data` all describe the request rather than the
 * session, so they must keep their existing paths instead of triggering a
 * reconnect and a replay.
 *
 * Each pattern is anchored to the whole message, after stripping an optional
 * `Bad Request:` prefix and trailing punctuation: these are short protocol
 * statements, not prose, so allowing a match anywhere is what made a payload
 * error look like a dead session.
 *
 * @param status - HTTP status of the response.
 * @param body - response text, already redacted when it came from a provider.
 * @returns whether the session is gone and the request is worth replaying.
 */
export function isDeadSession(status, body) {
  if (status !== 404 && status !== 400) return false;
  const raw = typeof body === 'string' ? body : '';
  if (!raw) return false;
  // Resolve the string the server actually called its error. A parsed object is
  // never searched as text: that would match a field or a hint instead.
  let message = raw;
  try {
    const parsed = JSON.parse(raw);
    const candidate = parsed?.error?.message ?? parsed?.error ?? parsed?.message;
    if (typeof candidate === 'string') message = candidate;
    else if (parsed && typeof parsed === 'object') message = '';
  } catch { /* a plain-text body is its own message */ }
  if (!message) return false;
  const text = message
    .replace(/^bad\s+request\s*:\s*/i, '')
    .replace(/[.?!]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // `<qualifier> session [id]`, where the qualifier states it is absent or bad.
  if (/^(?:missing|unknown|no|absent|invalid)\s+(?:transport\s+)?session(?:\s+(?:id|identifier))?$/i.test(text)) return true;
  // `session [id] <state>`, where the state is about existence or validity.
  if (/^(?:transport\s+)?session(?:\s+(?:id|identifier))?\s+(?:is\s+)?(?:not\s+found|not\s+known|not\s+recognised|not\s+recognized|missing|required|unknown|expired|invalidated)$/i.test(text)) return true;
  // The measured initialize hint from servers that require a session first.
  if (/^request\s+must\s+be\s+an?\s+initialize\s+request\s+if\s+no\s+session(?:\s+id)?\s+is\s+provided$/i.test(text)) return true;
  return false;
}
/**
 * Parse one SSE-framed response body into JSON-RPC messages.
 * @param text - raw body text.
 * @returns the messages found, in order.
 */
export function parseSseMessages(text) {
  const messages = [];
  let data = [];
  const flush = () => {
    if (data.length === 0) return;
    const value = data.join('\n');
    data = [];
    if (value === '[DONE]') return;
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) messages.push(...parsed);
      else messages.push(parsed);
    } catch {}
  };
  for (const line of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    if (line === '') flush();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  flush();
  return messages;
}




/** POST one JSON body and buffer the reply. */
export async function httpPostJson(url, headers, body, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const timer = rpcTimeout(() => ctrl.abort(new Error(`MCP request timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      redirect: 'manual',
    });
    const text = await resp.text();
    return { status: resp.status, headers: resp.headers, text };
  } finally {
    timer.cancel();
  }
}

/** OAuth token endpoints speak application/x-www-form-urlencoded (RFC 6749). */
export async function httpPostForm(url, headers, form, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers },
      body: new URLSearchParams(form).toString(),
      signal: ctrl.signal,
      redirect: 'manual',
    });
    const text = await resp.text();
    return { status: resp.status, headers: resp.headers, text };
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a response body as JSON, returning null when it is not JSON. */
export function parseBody(resp) {
  try { return JSON.parse(resp.text); } catch { return null; }
}

/**
 * Create the HTTP transport helpers for one plugin instance.
 *
 * Every collaborator is a port. The module is created once per plugin and the
 * ports close over the live plugin state, so a transport never holds a stale
 * copy of a server row or of a token.
 *
 * @param ports.authHeadersFor - builds the request headers for a server and handle.
 * @param ports.refreshToken - performs the single-flight token refresh; false when it could not repair.
 * @param ports.onAuthRejection - records an authentication rejection on the call path.
 * @param ports.recordAttempt - appends one attempt-log entry.
 * @param ports.redact - redacts provider text before it is stored or shown.
 * @param ports.discoverMetadata - returns the authorization-server metadata, persisting any cache change.
 * @param ports.baseScopeOf - returns the base scope selection for a server.
 * @param ports.persistOauthCache - persists the discovery cache after a 401 advertised it.
 * @param ports.replug - rebuilds a dead connection and returns its new handle.
 * @param ports.resolveTimeout - resolves the tool-call budget for a server.
 * @param ports.log - the host logger.
 * @returns the transport entry points.
 */
/**
 * Create the HTTP transport helpers for one plugin instance.
 *
 * Every collaborator is a port, and the ports close over live plugin state, so
 * a transport never holds a stale copy of a server row or of a token.
 *
 * @param ports.authHeadersFor - builds the request headers for a server and handle.
 * @param ports.refreshToken - performs the single-flight token refresh; resolves false when it could not repair.
 * @param ports.onAuthRejection - records an authentication rejection observed on the call path.
 * @param ports.recordAttempt - appends one attempt-log entry.
 * @param ports.redact - redacts provider text before it is stored.
 * @param ports.discoverMetadata - resolves and persists the authorization-server metadata.
 * @param ports.baseScopeOf - returns the base scope selection for a server and metadata.
 * @param ports.persistOauthCache - persists the discovery cache after a 401 advertised it.
 * @param ports.onSuccessfulCall - records a healthy authenticated call for the health view.
 * @param ports.replug - rebuilds a dead connection and resolves to its new handle.
 * @param ports.resolveTimeout - resolves the tool-call budget for a server.
 * @param ports.log - the host logger.
 * @returns the transport entry points.
 */
export function createHttpTransport({
  authHeadersFor,
  refreshToken = async () => false,
  ensureFreshToken = async () => {},
  onAuthRejection = () => {},
  recordAttempt = () => {},
  redact = (text) => String(text ?? ''),
  discoverMetadata = async () => null,
  baseScopeOf = () => ({ scope: '', source: 'none' }),
  persistOauthCache = async () => {},
  onSuccessfulCall = () => {},
  replug = null,
  resolveTimeout = resolveToolCallTimeout,
  log = { info() {}, warn() {} },
} = {}) {
  let rpcSeq = 1;

  /** Read the server's own error wording out of a response body, if any. */
  function serverReason(resp) {
    const raw = typeof resp?.text === 'string' ? resp.text : '';
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      return redact(parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? raw).slice(0, 200);
    } catch {
      return redact(raw).slice(0, 200);
    }
  }


  /** Read one response as JSON-RPC messages, forwarding notifications. */
  function parseRpc(resp, expectedId, conn) {
    const body = parseBody(resp);
    const messages = body == null
      ? parseSseMessages(resp.text)
      : (Array.isArray(body) ? body : [body]);
    for (const message of messages) {
      if (message && message.id == null) {
        if (typeof message.method === 'string') conn?.onNotification?.(message);
      }
    }
    if (expectedId !== undefined) return messages.find((message) => message?.id === expectedId) ?? null;
    return messages.find((message) => message?.id != null || message?.result !== undefined || message?.error !== undefined) ?? null;
  }

  /**
   * The 401 advertises the protected-resource metadata URL (RFC 9728 section 5.1).
   * Caching it lets the next authorize skip the whole probing chain. A `scope`
   * in a 401 challenge is the server's own statement of what this endpoint
   * needs, so it is cached as `challengeScope`. A 403 `insufficient_scope`
   * challenge must NOT be cached the same way: it names scopes required *on top
   * of* the current grant, so treating it as the base selection would replace
   * the advertised scopes instead of extending them.
   */
  async function captureResourceMetadata(server, resp, { cacheScope = true } = {}) {
    const challenge = parseBearerChallenge(resp.headers?.get?.('www-authenticate'));
    if (!challenge) return;
    let changed = false;
    const url = challenge.resource_metadata;
    if (url && /^https?:\/\//.test(url) && server.oauth?.resourceMetadataUrl !== url) {
      server.oauth = server.oauth ?? {};
      server.oauth.resourceMetadataUrl = url;
      changed = true;
    }
    const scope = cacheScope ? cleanScope(challenge.scope) : '';
    if (scope && server.oauth?.challengeScope !== scope) {
      server.oauth = server.oauth ?? {};
      server.oauth.challengeScope = scope;
      changed = true;
    }
    if (changed) await persistOauthCache(server);
  }


  /**
   * A 403 from an authenticated OAuth request means the token is valid but not
   * enough: RFC 6750 section 3.1 `insufficient_scope`, or a server (Laravel MCP,
   * Passport) that answers a scope-less token with a bare 403. Either way the
   * fix is a new authorization, not a retry, so report it as such.
   */
  async function insufficientScopeError(server, resp, what, { requireFlag = false } = {}) {
    if (resp.status !== 403 || server.authMode !== 'oauth' || !server.oauth?.tokens?.access_token) return null;
    const challenge = parseBearerChallenge(resp.headers?.get?.('www-authenticate'));
    const flagged = challenge?.error === 'insufficient_scope';
    // A 403 that names some other error is not about scope; a bare 403 from a
    // single tool call may be a per-tool permission denial, not the token.
    if (challenge?.error && !flagged) return null;
    if (requireFlag && !flagged) return null;
    // Only the resource_metadata pointer is cached here: the challenged scopes
    // belong in `insufficientScope` so the scope selection adds them to the base
    // instead of letting them replace it.
    await captureResourceMetadata(server, resp, { cacheScope: false });
    let scope = cleanScope(challenge?.scope);
    if (!scope) {
      // A bare 403 names nothing; the advertised scopes are the best statement
      // of what this resource needs.
      let md = null;
      try { md = await discoverMetadata(server); } catch {}
      scope = baseScopeOf(server, md).scope;
    }
    server.oauth.insufficientScope = { scope, at: Date.now() };
    const reason = serverReason(resp);
    const message = `insufficient scope${scope ? ` (requires: ${scope})` : ''}: re-authenticate to grant access${reason ? ` - server said: ${reason}` : ''}`;
    const error = new AuthRequiredError(message, { kind: 'insufficient-scope', reason: message });
    error.status = 403;
    error.insufficientScope = true;
    error.requiredScope = scope;
    recordAttempt(server, { phase: what, url: server.url, status: 403, detail: error.message });
    return error;
  }

  /** Record the protocol revision the server actually selected. */
  function logProtocolVersion(server, initResult) {
    const notice = protocolVersionNotice(server.name, initResult);
    if (!notice) return;
    if (notice.level === 'warn') log.warn(notice.message);
    else log.info(notice.message);
  }


  /**
   * Run one Streamable HTTP JSON-RPC request.
   *
   * A 401 is repaired once by a token refresh. A response that says the server
   * no longer knows the transport session is repaired by rebuilding the
   * connection and replaying the request once - the caller never sees the first
   * rejection, because a dead session is not something it could act on.
   *
   * @param server - configuration row that owns the request.
   * @param method - JSON-RPC method.
   * @param params - JSON-RPC params, omitted when undefined.
   * @param conn - the connection handle carrying the session and notifications.
   * @param options.isNotification - send without an id and expect no result.
   * @param options.timeoutMs - request budget.
   * @param options.handle - the live handle to replay against after a replug.
   * @returns the JSON-RPC result, or null for a notification.
   */
  async function mcpRpc(server, method, params, conn, { isNotification = false, timeoutMs = 60000, handle = null, repair = true } = {}) {
    const payload = { jsonrpc: '2.0', method };
    if (params !== undefined) payload.params = params;
    const requestId = isNotification ? undefined : rpcSeq++;
    if (!isNotification) payload.id = requestId;
    const send = async (target) => httpPostJson(server.url, authHeadersFor(server, target), payload, timeoutMs);
    // Refresh shortly before expiry instead of waiting for a 401: a server without a
    // notification stream would otherwise carry a near-expiry token into this call.
    if (repair) await ensureFreshToken(server);
    // The connection that actually serves this request: a repair replaces it.
    let active = conn;
    let resp = await send(active);
    if (resp.status === 401 && server.authMode === 'oauth' && (await refreshToken(server))) {
      resp = await send(active);
    }
    // A dead session is machine-repairable: rebuild the connection and replay
    // the same request exactly once. Only an unrepaired second failure reaches
    // the caller.
    if (repair && replug && isDeadSession(resp.status, resp.text)) {
      const rebuilt = await replug(server, handle ?? conn);
      if (rebuilt && rebuilt.handle) {
        // Replay through the replacement connection so the reply and its
        // notifications belong to the session that actually served the request.
        active = rebuilt.handle;
        handle = rebuilt.handle;
        resp = await send(active);
      } else if (rebuilt && rebuilt.status === 'needs-auth') {
        // A rebuild refused for authentication belongs on the existing wait path.
        const why = rebuilt.error || 'authentication required';
        throw new AuthRequiredError(`MCP ${method}: ${why}`, { kind: 'unauthorized', reason: why });
      } else {
        const why = rebuilt && rebuilt.error ? `: ${rebuilt.error}` : '';
        throw new Error(`MCP ${method}: transport session expired and the reconnect failed${why}`);
      }
    }
    if (resp.status === 403) {
      const scopeError = await insufficientScopeError(server, resp, method, { requireFlag: method === 'tools/call' });
      if (scopeError) throw scopeError;
    }
    if (resp.status === 401) {
      const reason = serverReason(resp) || 'authentication required';
      throw new AuthRequiredError(`MCP ${method} HTTP 401: ${reason}`, { kind: 'unauthorized', reason });
    }
    if (resp.status >= 400) throw new Error(`MCP ${method} HTTP ${resp.status}: ${serverReason(resp)}`);
    const parsed = parseRpc(resp, requestId, active);
    if (isNotification) return null;
    if (!parsed) throw new Error(`MCP ${method}: non-JSON response`);
    if (parsed.error) throw new Error(`MCP ${method}: ${parsed.error.message ?? JSON.stringify(parsed.error)}`);
    if (server.authMode === 'oauth') onSuccessfulCall(server);
    return parsed.result;
  }


  /** Fetch every page of `tools/list` from one handle. */
  async function listAllTools(handle) {
    const tools = [];
    const seenCursors = new Set();
    let cursor;
    do {
      const listed = await handle.listTools(cursor);
      if (!Array.isArray(listed?.tools)) throw new Error('MCP tools/list returned no tools array');
      tools.push(...listed.tools);
      const next = typeof listed.nextCursor === 'string' && listed.nextCursor ? listed.nextCursor : undefined;
      if (next && seenCursors.has(next)) throw new Error(`MCP tools/list repeated cursor "${next}"`);
      if (next) seenCursors.add(next);
      cursor = next;
    } while (cursor !== undefined);
    return tools;
  }

  /** A response is worth retrying as an SSE session only for these shapes. */
  function looksLikeSseEndpoint(resp, parsed) {
    if (parsed) return false;                                  // already a JSON-RPC payload
    if (resp.status >= 200 && resp.status < 300) return true;   // 2xx but not JSON (202/empty)
    return /session\s*id/i.test(String(resp.text ?? ''));       // error text names a session id
  }

  /** Turn an `event:`/`data:` frame into JSON-RPC messages, forwarding each one. */
  function dispatchSseFrame(block, onMessage) {
    let event = null;
    const data = [];
    for (const line of String(block).replace(/\r\n/g, '\n').split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (event === 'endpoint') return { endpoint: data.join('\n').trim() };
    for (const message of parseSseMessages(`${block}\n\n`)) onMessage?.(message);
    return null;
  }


  /**
   * Open the GET stream and resolve the advertised POST target.
   * `closed` is polled by the caller's retry loop, so a stream teardown simply
   * rejects the read and lets the caller decide whether to reconnect.
   */
  async function openSseSession(server, handle, abortController, onMessage, waiters) {
    const open = () => fetch(server.url, {
      method: 'GET',
      headers: { Accept: 'text/event-stream', ...authHeadersFor(server, handle) },
      signal: abortController.signal,
      redirect: 'manual',
    });
    let resp = await open();
    if (resp.status === 401 && server.authMode === 'oauth' && (await refreshToken(server))) {
      await resp.body?.cancel().catch(() => {});
      resp = await open();
    }
    if (resp.status === 401) {
      // Surface the server own wording - "missing or invalid token" is far more
      // actionable than a bare "authentication required".
      const reason = serverReason(resp) || 'authentication required';
      throw new AuthRequiredError(`HTTP 401: ${reason}`, { kind: 'unauthorized', reason });
    }
    if (resp.status === 403) {
      // fetch() bodies are streams; serverReason expects the buffered shape.
      const text = await resp.text().catch(() => '');
      const scopeError = await insufficientScopeError(server, { status: 403, headers: resp.headers, text }, 'sse');
      if (scopeError) throw scopeError;
    }
    if (!resp.ok || !resp.body) throw new Error(`SSE GET HTTP ${resp.status}`);

    let endpointResolve;
    const endpointReady = new Promise((resolve) => { endpointResolve = resolve; });
    const decoder = new TextDecoder();
    let buffer = '';
    let sawEndpoint = false;

    // Consume frames for the lifetime of the stream. Both the endpoint frame and
    // every JSON-RPC reply travel this one connection. The stream ending means the
    // session is gone, so pending callers are failed rather than left to time out.
    let streamEnded = false;
    const endStream = () => {
      if (streamEnded) return;
      streamEnded = true;
      for (const waiter of waiters.values()) {
        waiter.timer.cancel();
        waiter.reject(new Error('SSE stream closed'));
      }
      waiters.clear();
      if (!handle.closed) handle.onStreamClosed?.();
    };
    void (async () => {
      try {
        for await (const chunk of resp.body) {
          buffer += decoder.decode(chunk, { stream: true });
          buffer = buffer.replace(/\r\n/g, '\n');
          let split;
          while ((split = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const found = dispatchSseFrame(block, onMessage);
            if (found?.endpoint && !sawEndpoint) {
              sawEndpoint = true;
              endpointResolve(found.endpoint);
            }
          }
        }
        buffer += decoder.decode();
        for (const message of parseSseMessages(buffer)) onMessage?.(message);
      } catch {
      } finally {
        if (!sawEndpoint) endpointResolve(null);
        endStream();
      }
    })();

    const endpoint = await Promise.race([
      endpointReady,
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve(undefined), 15000);
        timer.unref?.();
      }),
    ]);
    if (!endpoint) {
      abortController.abort();
      throw new Error('SSE stream did not advertise an endpoint within 15s');
    }

    let endpointUrl;
    try {
      endpointUrl = new URL(endpoint, server.url).toString();
    } catch {
      abortController.abort();
      throw new Error('SSE stream advertised an unusable endpoint');
    }
    return { endpointUrl };
  }

  /** POST one JSON-RPC message to the advertised SSE session endpoint. */
  async function sseSessionPost(server, handle, endpointUrl, payload, timeoutMs = 60000) {
    const controller = new AbortController();
    const timer = rpcTimeout(() => controller.abort(new Error(`MCP request timeout after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
    try {
      const post = () => fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...authHeadersFor(server, handle) },
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: 'manual',
      });
      let resp = await post();
      // The same one-shot refresh the Streamable HTTP path performs: an ordinary
      // expiry must not park the call for a human.
      if (resp.status === 401 && server.authMode === 'oauth' && (await refreshToken(server))) {
        await resp.body?.cancel().catch(() => {});
        resp = await post();
      }
      if (resp.status === 401) {
        const reason = serverReason(resp) || 'authentication required';
        throw new AuthRequiredError(`HTTP 401: ${reason}`, { kind: 'unauthorized', reason });
      }
      if (resp.status === 403) {
        const text = await resp.text().catch(() => '');
        const scopeError = await insufficientScopeError(server, { status: 403, headers: resp.headers, text }, payload.method ?? 'sse', { requireFlag: payload.method === 'tools/call' });
        if (scopeError) throw scopeError;
        throw new Error(`POST HTTP 403${text ? `: ${serverReason({ text })}` : ''}`);
      }
      if (resp.status >= 400) {
        // Buffer the rejection so the shared predicate can read its own wording:
        // a live Fetch response has no `text` property for `serverReason`.
        const body = await resp.text().catch(() => '');
        if (isDeadSession(resp.status, body)) return { dead: true };
        const reason = serverReason({ text: body });
        throw new Error(`POST HTTP ${resp.status}${reason ? `: ${reason}` : ''}`);
      }
      // 202 Accepted with an empty body is the normal SSE-session reply.
      await resp.body?.cancel().catch(() => {});
      return { dead: false };
    } finally {
      timer.cancel();
    }
  }

  /** Resolve a pending waiter for one JSON-RPC reply frame. */
  function settleSseReply(handle, waiters, message) {
    if (message?.id == null || !waiters.has(message.id)) return;
    const waiter = waiters.get(message.id);
    waiters.delete(message.id);
    waiter.timer.cancel();
    if (message.error) waiter.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  }

  /**
   * Run a request over an SSE session, correlating the reply by JSON-RPC id.
   * Replies are delivered by the stream pump, so this only needs a waiter table.
   */
  function sseSessionCall(server, handle, endpointUrl, waiters, { repair = true } = {}) {
    return (method, params, { isNotification = false, timeoutMs = 60000 } = {}) => {
      const payload = { jsonrpc: '2.0', method };
      if (params !== undefined) payload.params = params;
      if (isNotification) {
        return sseSessionPost(server, handle, endpointUrl, payload, timeoutMs).then((outcome) => {
          // A notification has no reply to wait for; the next request rebuilds.
          if (outcome?.dead) throw new Error('MCP ' + method + ': transport session expired');
          return null;
        });
      }
      const id = rpcSeq++;
      payload.id = id;
      return new Promise((resolve, reject) => {
        const timer = rpcTimeout(() => {
          waiters.delete(id);
          reject(new Error(`MCP ${method} timeout after ${timeoutMs}ms (no SSE reply)`));
        }, timeoutMs);
        timer.unref?.();
        waiters.set(id, { resolve, reject, timer });
        // A dead session is repaired exactly as the Streamable HTTP path repairs
        // it: rebuild the connection and replay once through the new session.
        // The old waiter is dropped because its reply can never arrive.
        void (async () => {
          let outcome = await sseSessionPost(server, handle, endpointUrl, payload, timeoutMs);
          if (outcome && outcome.dead && repair && replug) {
            waiters.delete(id);
            timer.cancel();
            const rebuilt = await replug(server, handle);
            if (rebuilt && rebuilt.status === 'needs-auth') {
              // A rebuild refused for authentication belongs on the existing wait path.
              const why = rebuilt.error || 'authentication required';
              throw new AuthRequiredError(`MCP ${method}: ${why}`, { kind: 'unauthorized', reason: why });
            }
            if (!rebuilt || !rebuilt.handle) {
              const why = rebuilt && rebuilt.error ? `: ${rebuilt.error}` : '';
              throw new Error(`MCP ${method}: transport session expired and the reconnect failed${why}`);
            }
            const fresh = rebuilt.handle;
            const freshEndpoint = fresh.sessionEndpoint || endpointUrl;
            const freshWaiters = fresh.waiters || waiters;
            const retryTimer = rpcTimeout(() => {
              freshWaiters.delete(id);
              reject(new Error("MCP " + method + " timeout after " + timeoutMs + "ms (no SSE reply)"));
            }, timeoutMs);
            retryTimer.unref?.();
            freshWaiters.set(id, { resolve, reject, timer: retryTimer });
            try {
              outcome = await sseSessionPost(server, fresh, freshEndpoint, payload, timeoutMs);
              if (outcome && outcome.dead) throw new Error(`MCP ${method}: transport session expired after reconnecting`);
            } catch (error) {
              // The replacement waiter must not outlive a rejected replay.
              freshWaiters.delete(id);
              retryTimer.cancel();
              throw error;
            }
            return;
          }
          if (outcome && outcome.dead) throw new Error("MCP " + method + ": transport session expired");
        })().catch((error) => {
          waiters.delete(id);
          timer.cancel();
          reject(error);
        });
      });
    };
  }

  /**
   * Open an HTTP-with-SSE session and return a handle with the same contract as
   * `openHttp`, so callers never special-case the transport.
   */
  async function openSse(server) {
    const handle = {
      kind: 'http', sessionId: null, transport: 'sse', tools: [], closed: false,
      onNotification: null, notificationStarted: false, notificationController: null,
      call: () => Promise.reject(new Error('not connected')),
      listTools: () => Promise.reject(new Error('not connected')),
      startNotifications: () => {},   // the session stream already carries notifications
      close() {
        handle.closed = true;
        handle.notificationController?.abort();
      },
    };

    const controller = new AbortController();
    handle.notificationController = controller;
    handle.notificationStarted = true;   // the session stream already carries notifications

    const waiters = new Map();
    // One dispatcher settles replies by id and forwards everything else
    // (notifications) to the handle listener.
    const onMessage = (message) => {
      if (message?.id != null) settleSseReply(handle, waiters, message);
      else if (typeof message?.method === 'string') handle.onNotification?.(message);
    };

    try {
      const session = await openSseSession(server, handle, controller, onMessage, waiters);
      handle.sessionId = new URL(session.endpointUrl).searchParams.get('sessionId') ?? null;
      handle.sessionEndpoint = session.endpointUrl;

      // The handshake establishes this very connection, so none of it may repair:
      // it would await the rebuild that is awaiting it. That includes the first
      // tool listing, which is part of establishing the connection.
      const handshake = sseSessionCall(server, handle, session.endpointUrl, waiters, { repair: false });

      const init = await handshake('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'dsh-mcp-manager', version: '0.6.0' },
      });
      logProtocolVersion(server, init);
      await handshake('notifications/initialized', undefined, { isNotification: true }).catch(() => {});
      handle.tools = await listAllTools({ listTools: (cursor) => handshake('tools/list', cursor === undefined ? {} : { cursor }) });
      handle.initResult = init;

      // Only once the connection is established do live calls get a table that may
      // repair. They share the waiter map so a replay can re-key onto the replacement.
      const live = sseSessionCall(server, handle, session.endpointUrl, waiters);
      handle.call = (name, args) => live('tools/call', { name, arguments: args }, { timeoutMs: resolveTimeout(server) });
      handle.listTools = (cursor) => live('tools/list', cursor === undefined ? {} : { cursor });
      handle.waiters = waiters;
      return handle;
    } catch (error) {
      // A failed handshake must not leave an SSE reader alive across retries.
      handle.close();
      throw error;
    }
  }

  /**
   * Establish a Streamable HTTP transport: initialize, fetch the tool listing, and
   * return a handle both tiers register from.
   */
  async function openHttp(server) {
    const handle = {
      kind: 'http', sessionId: null, transport: null, tools: [], closed: false,
      onNotification: null, notificationStarted: false, notificationController: null,
      call: () => Promise.reject(new Error('not connected')),
      listTools: () => Promise.reject(new Error('not connected')),
      startNotifications: () => {},
      close() {
        handle.closed = true;
        handle.notificationController?.abort();
      },
    };
    // Refresh shortly before expiry instead of waiting for a 401 on the first call.
    await ensureFreshToken(server);
    const initId = rpcSeq++;
    const initPayload = { jsonrpc: '2.0', id: initId, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'dsh-mcp-manager', version: '0.6.0' } } };
    let resp = await httpPostJson(server.url, authHeadersFor(server, handle), initPayload);
    if (resp.status === 401 && server.authMode === 'oauth' && (await refreshToken(server))) {
      resp = await httpPostJson(server.url, authHeadersFor(server, handle), initPayload);
    }
    if (resp.status === 401) {
      // The 401 advertises which authorization server protects this endpoint.
      await captureResourceMetadata(server, resp);
      // Prefer the server own wording when it supplies one.
      const reason = serverReason(resp) || 'authentication required';
      throw new AuthRequiredError(`HTTP 401: ${reason}`, { kind: 'unauthorized', reason });
    }
    const scopeError = await insufficientScopeError(server, resp, 'initialize');
    if (scopeError) throw scopeError;
    const init = parseRpc(resp, initId, handle);

    // A server that answers a bare POST with a session-id complaint is speaking
    // HTTP-with-SSE, not Streamable HTTP - retry it over a real SSE session.
    if (!init && looksLikeSseEndpoint(resp, init)) {
      const why = `HTTP ${resp.status}${serverReason(resp) ? `: ${serverReason(resp)}` : ''}`;
      try {
        const sseHandle = await openSse(server);
        log.info(`mcp-manager: ${server.name} connected over ${sseHandle.transport} transport (Streamable HTTP probe: ${why})`);
        return sseHandle;
      } catch (error) {
        // A typed authentication rejection must keep its type so the existing
        // recovery and needs-auth paths still see it.
        if (error instanceof AuthRequiredError) throw error;
        throw new Error(`server looks like HTTP-with-SSE but the SSE session failed (Streamable HTTP probe: ${why}): ${error?.message ?? error}`);
      }
    }

    if (resp.status >= 400) throw new Error(`initialize HTTP ${resp.status}${serverReason(resp) ? `: ${serverReason(resp)}` : ''}`);
    if (!init || init.error) throw new Error(`initialize failed: ${serverReason(resp)}`);
    logProtocolVersion(server, init.result);
    const sid = resp.headers?.get?.('mcp-session-id');
    handle.sessionId = sid ?? null;
    // No repair during the handshake: a replug is in flight while this runs, and
    // a repair here would await the very promise that is awaiting it.
    await mcpRpc(server, 'notifications/initialized', undefined, handle, { isNotification: true, handle, repair: false }).catch(() => {});
    handle.listTools = (cursor) => mcpRpc(server, 'tools/list', cursor === undefined ? {} : { cursor }, handle, { handle, repair: false });
    handle.tools = await listAllTools(handle);
    handle.call = (name, args) => mcpRpc(server, 'tools/call', { name, arguments: args }, handle, { timeoutMs: resolveTimeout(server), handle });
    if (init.result?.capabilities?.tools?.listChanged === true) {
      handle.startNotifications = () => startHttpNotificationStream(server, handle);
    }
    return handle;
  }

  /**
   * Keep a GET event stream open for server-initiated notifications. A stream that
   * ends is retried, because the tools-changed signal is the only way a server can
   * announce a new tool set between calls.
   */
  function startHttpNotificationStream(server, handle) {
    if (handle.notificationStarted || handle.closed) return;
    handle.notificationStarted = true;
    const controller = new AbortController();
    handle.notificationController = controller;
    void (async () => {
      while (!controller.signal.aborted && !handle.closed) {
        try {
          await ensureFreshToken(server);
          const request = () => fetch(server.url, {
            method: 'GET',
            headers: { Accept: 'text/event-stream', ...authHeadersFor(server, handle) },
            signal: controller.signal,
            redirect: 'manual',
          });
          let response = await request();
          if (response.status === 401 && server.authMode === 'oauth' && (await refreshToken(server))) {
            await response.body?.cancel().catch(() => {});
            response = await request();
          }
          if (response.status === 404 || response.status === 405) return;
          if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
          const decoder = new TextDecoder();
          let buffer = '';
          for await (const chunk of response.body) {
            buffer += decoder.decode(chunk, { stream: true });
            buffer = buffer.replace(/\r\n/g, '\n');
            let split;
            while ((split = buffer.indexOf('\n\n')) >= 0) {
              const block = buffer.slice(0, split);
              buffer = buffer.slice(split + 2);
              for (const message of parseSseMessages(`${block}\n\n`)) handle.onNotification?.(message);
            }
          }
          buffer += decoder.decode();
          for (const message of parseSseMessages(buffer)) handle.onNotification?.(message);
        } catch (error) {
          if (controller.signal.aborted || handle.closed) return;
          log.warn(`mcp-manager: notification stream for ${server.name} stopped: ${error?.message ?? error}`);
        }
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 1000);
          controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
    })();
  }

  return {
    isDeadSession,
    logProtocolVersion,
    parseSseMessages,
    parseBody,
    parseRpc,
    serverReason,
    listAllTools,
    mcpRpc,
    httpPostJson,
    openHttp,
    openSse,
    sseSessionPost,
    captureResourceMetadata,
    insufficientScopeError,
    startHttpNotificationStream,
  };
}
