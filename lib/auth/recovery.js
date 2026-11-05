/**
 * Recovery of an MCP tool call that cannot authenticate.
 *
 * The transports throw {@link AuthRequiredError} when a rejected request cannot
 * be repaired by a token refresh. This module turns that failure into either a
 * completed reauthorization (the call resumes) or an actionable error, and it
 * is the only place the model-facing error text is built.
 */

import { serverKey } from './gate.js';

/**
 * A transport rejection that needs a human authorization.
 */
export class AuthRequiredError extends Error {
  /**
   * @param message - technical transport text, kept for logs.
   * @param options.kind - `unauthorized` or `insufficient-scope`.
   * @param options.reason - actionable reason from the resource server.
   */
  constructor(message, { kind = 'unauthorized', reason = '' } = {}) {
    super(message);
    this.name = 'AuthRequiredError';
    this.authRequired = true;
    this.kind = kind;
    this.reason = reason || String(message ?? '');
  }
}

/**
 * @param error - any thrown value.
 * @returns whether it is an authentication rejection.
 */
export function isAuthRequiredError(error) {
  return error?.authRequired === true;
}

/**
 * The session that owns a tool call, when the harness supplies one.
 * @param exec - tool run context.
 * @returns the session id, or an empty string.
 */
export function sessionIdOf(exec) {
  const agent = exec?.agent;
  return agent?.id ?? agent?.sessionId ?? '';
}

/**
 * Whether this server can be authorized through a browser.
 * @param server - configuration row.
 */
export function canBrowserAuthorize(server) {
  return (server?.type ?? 'http') !== 'stdio' && server?.authMode === 'oauth';
}

/**
 * Build the model-facing error for a wait that ended without a successful
 * retry. It names the server, states that the call was not executed and points
 * at both places the operator can reauthorize. It never carries a credential.
 *
 * @param server - configuration row.
 * @param options.outcome - `timeout`, `cancelled`, `disabled`, `retry` or `no-auth-flow`.
 * @param options.reason - already-redacted failure text.
 * @param options.budgetMs - the wait budget, for the timeout wording.
 * @returns the error message.
 */
export function authFailureMessage(server, { outcome = 'cancelled', reason = '', budgetMs = 120000 } = {}) {
  const name = `MCP server "${server?.name ?? 'unknown'}"`;
  const detail = String(reason ?? '').trim();
  const where = 'Authenticate from the conversation banner or in Settings → MCP, then try again.';
  if (outcome === 'no-auth-flow') {
    return `${name} rejected the call with an authentication error and the call was not executed: this server does not use browser authorization. Update its token in Settings → MCP, then try again.`;
  }
  if (outcome === 'timeout') {
    const seconds = Math.max(1, Math.round(Number(budgetMs) / 1000));
    return `${name} needs authentication and the call was not executed: no authorization completed within ${seconds}s. ${where}`;
  }
  if (outcome === 'disabled') {
    return `${name} was disabled while the call waited for authentication and the call was not executed. ${where}`;
  }
  if (outcome === 'retry') {
    return `${name} still rejected the call after reauthorization${detail ? ` (${detail})` : ''} and the call was not executed. ${where}`;
  }
  return `${name} needs authentication and the call was not executed: the authorization was cancelled. ${where}`;
}

/**
 * Run one MCP call with authentication recovery.
 *
 * The first attempt happens immediately. A non-authentication failure is
 * rethrown unchanged. An authentication rejection marks the connection through
 * `onAuthRequired`, waits for a reauthorization bounded by the gate budget and
 * retries exactly once. Every wait outcome other than a completed
 * authorization becomes the actionable error.
 *
 * @param options.call - the transport call, retried with the same arguments.
 * @param options.gate - the authentication gate.
 * @param options.server - the configuration row that served the call.
 * @param options.exec - the tool run context (session and cancellation signal).
 * @param options.onAuthRequired - records the connection state; called before waiting.
 * @param options.onWaitEnded - host hook for a terminal wait outcome (no retry will run).
 * @param options.redact - redacts provider text before it is displayed.
 * @returns the call result.
 */
export async function withAuthRecovery({ call, gate, server, exec, onAuthRequired, onWaitEnded, redact = (text) => String(text ?? '') }) {
  const failureAt = Date.now();
  try {
    return await call();
  } catch (error) {
    if (!isAuthRequiredError(error)) throw error;
    const reason = redact(error.reason || error.message);
    try { onAuthRequired?.(error); } catch {}
    if (!canBrowserAuthorize(server)) {
      throw new Error(authFailureMessage(server, { outcome: 'no-auth-flow', reason }));
    }
    try {
      await gate.block({
        key: serverKey(server),
        serverId: server.id,
        sessionId: sessionIdOf(exec),
        scope: server.wsPath ? 'workspace' : 'global',
        workspacePath: server.wsPath ?? '',
        name: server.name,
        reason,
        failureAt,
        signal: exec?.signal,
      });
    } catch (waitError) {
      const outcome = waitError?.outcome ?? 'cancelled';
      try { await onWaitEnded?.(outcome); } catch {}
      if (outcome === 'aborted') {
        const aborted = new Error('MCP tool call interrupted while waiting for authentication');
        aborted.name = 'AbortError';
        throw aborted;
      }
      throw new Error(authFailureMessage(server, {
        outcome: outcome === 'timeout' || outcome === 'disabled' ? outcome : 'cancelled',
        reason,
        budgetMs: gate.budgetMs,
      }));
    }
    try {
      return await call();
    } catch (retryError) {
      if (!isAuthRequiredError(retryError)) throw retryError;
      throw new Error(authFailureMessage(server, {
        outcome: 'retry',
        reason: redact(retryError.reason || retryError.message),
        budgetMs: gate.budgetMs,
      }));
    }
  }
}
