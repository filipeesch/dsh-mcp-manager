# v0.21.0: authenticate an MCP server from the conversation

Related board task: *autenticar mcp dentro da conversa* (Open Spec v1).
OpenSpec change: `authenticate-mcp-from-chat`.

An OAuth MCP server whose token expired in the middle of a turn used to end the
tool call with a transport error (`MCP tools/call HTTP 401: invalid_token`). The
connection stayed "connected", no surface offered a way out, and the operator had
to leave the conversation, open Settings → MCP, reauthenticate and ask again.

This release makes the call wait for a human reauthorization and puts that action
inside the conversation.

## Changes

- **A rejected call waits.** A `tools/call` refused with `401`, or with an
  explicit `403 insufficient_scope`, that the token refresh cannot repair now
  parks instead of failing. The connection moves to `needs-auth`, the waiting
  call is recorded against its session, and the wait is bounded by
  `config.authWaitMs` (default `120000`, minimum `1000`).
- **One retry, then a clear answer.** When an authorization completes and the
  server reconnects, every waiting call of that server resumes and is retried
  once with the same arguments, across sessions. A retry that is rejected again
  fails with the actionable error instead of starting a second wait.
- **Every authenticated transport reports the failure.** The Streamable HTTP
  call path, the legacy HTTP-with-SSE POST and the SSE stream handshake all throw
  the same typed `AuthRequiredError`, and the SSE paths now perform the same
  one-shot refresh the Streamable HTTP path already did. Connection-only
  failures (`initialize`, `tools/list`) never wait, because there is no call to
  resume; they still move the connection to `needs-auth`.
- **A conversation banner.** Above the composer, one row per waiting server with
  the reason, the number of waiting calls, the time left, the failure of the last
  attempt (if any) and two actions: **Authenticate**, which starts the existing
  authorization and opens the provider page in the system browser, and
  **Cancel**, which releases that conversation's calls with the actionable
  error. The banner lists only calls waiting for the current conversation — a
  global server or a server of that conversation's workspace — polls the host
  every two seconds, carries no token, and disappears with the last waiting call.
- **An actionable error.** Timeout, cancellation, a server disabled or removed
  while waiting, or a failed retry end the call with an error that names the
  server, states that the call was not executed, and points at the banner and
  Settings → MCP. A failed authorization attempt does not end the wait: the row
  shows the failure and lets the operator try again until the budget expires.
- **Static and stdio servers fail fast.** They have no browser flow, so they
  never wait and never appear in the banner; the error tells the operator to
  update the token in Settings → MCP.
- **One read-only attention API.** `GET /mcp-manager/api/attention` lists the
  waiting calls (`serverId`, `sessionId`, `scope`, `workspacePath`, `name`,
  `reason`, `error`, `phase`, `pending`, `remainingMs`), and
  `POST /mcp-manager/api/attention/cancel` releases one session's calls,
  releasing a pending authorization listener only when no other waiter remains.
  Disabling or deleting a server settles its waiters (a workspace rename does too;
  a global rename reconnects and can resume them). Neither response contains a
  token, a client secret or the authorization URL.
- **Refactoring carried by the change.** The wait lives in `lib/auth/gate.js`
  (state, deadline, abort wiring, cancellation, attention snapshot) and the
  orchestration in `lib/auth/recovery.js` (typed failure, single retry, message),
  both with injected ports. The two Settings rows and the banner share one
  start-authorization helper. The global tool call resolves the live connection
  at attempt time, so the retry runs against the connection the authorization
  created. The callback pages now mention the conversation banner as a place to
  restart an authorization.

## Compatibility

- No state-file change and no token-shape change; the feature activates only when
  an authenticated call actually fails. Downgrading keeps every server, token and
  configuration working.
- The banner renders in `conversation.input.dock`, which the `0.2.x` client
  builds declare (composition verified on `0.2.0-rc.2`, the slot also declared in
  `0.2.1`/`0.2.2`); a build without that slot simply never renders it.
- The Settings → MCP behavior is unchanged. A connection that needs
  authentication without a waiting call still appears only there.
- A subagent's waiting call has no visible banner (its session is not open as a
  conversation); it ends by the timeout or by cancellation. Two DSH processes
  sharing one profile do not wake each other's waiters.

## Verification

`npm test` covers the new surface:

- `test/auth-gate.test.js` — deadline, shared entry, resume-before-block, session
  scoping, abort, dispose, listing shape and failure text.
- `test/auth-recovery.test.js` — typed classification, wait and single retry,
  static refusal, timeout/cancel/disabled/abort outcomes, message content and
  redaction.
- `test/attention-api.test.js` — the read-only listing, the authorizing phase,
  the recorded failure of a refused attempt, session-scoped cancel, and the
  absence of tokens in the payload.
- `test/auth-blocking.test.js` — real loopback MCP + authorization server: park
  and resume with the same arguments, configured budget, cancel releasing the
  listener, Esc settling as interrupted, disable while waiting, workspace scope
  through `/workspaces/auth`, a static token failing immediately, a
  connection-only failure creating no wait, one authorization resuming two
  sessions, and an insufficient-scope rejection waiting like a `401`.
- `test/client-chat-auth.test.js` — slot registration, session filtering, the
  three phases, Authenticate with the global and workspace endpoints, a blocked
  popup's manual link, Cancel, polling and interval cleanup, disappearance after
  empty or failed polls, and both languages. The SSE branch of the refresh
  parity is covered by the `sse: true` fixture in `test/auth-blocking.test.js`.

Disposable-profile run (macOS, Node 24.21.0, DSH `0.2.0-rc.2`): the plugin was
installed from the worktree into a scratch `$DSH_HOME`, `dsh --profile web`
booted on a free port, `GET /mcp-manager/api/ping` and
`GET /mcp-manager/api/attention` answered `200`, and the served boot graph
included `dsh-mcp-manager/client.js`; the combined bundle carried the
`conversation.input.dock` registration, `mcp-manager-auth` and the banner styles.
The banner's on-screen placement inside a running GUI was **not** visually
verified — no browser control was available for this run.
