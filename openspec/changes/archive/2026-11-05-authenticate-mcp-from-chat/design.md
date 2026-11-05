# Design

## Context

See `proposal.md` — Why. The behavior this design must produce is in `specs/mcp-auth-recovery/spec.md` and `specs/mcp-chat-auth/spec.md`; this document explains the approach, not the contract.

Current state that shapes it:

- Tool execution is one definition per MCP tool (`makeToolDefinition`, `lib/index.js:2698`). Its `execute(args, exec)` closes over a per-tier `call` function: `registerToolsGlobal` (`:2810`) captures `conn` when it registers, while `registerWorkspaceTools` (`:3700`) resolves the live workspace connection at call time.
- `mcpRpc` (`:2113`) refreshes once after a `401` and then throws a plain `Error` with the technical text; `sseSessionPost` (`:2990`) throws on `401` without attempting a refresh; `openHttp` (`:3202`) also refreshes once while connecting. Only the `403 insufficient_scope` path records `needs-auth`, and only for a global server (`:2126`).
- `connect()` decides `needs-auth` from `server.oauth.needsReauth` and records the failure, so a call-path `401` that does not set `needsReauth` leaves the UI showing `connected`.
- A completed authorization (`completeAuthorization`, `:1767`) exchanges the code, reconnects the server and re-registers its tools. `cancelSessionsFor` (`:1151`) already removes pending flows for a server and releases their listeners. `setServerAuthStatus` (`:3455`) is the single status writer across both tiers.
- The DSH tool contract (`ToolRunContext`) always supplies `exec.signal`; a definition without `timeoutMs` is not cut by `dsh-tool-call-timeout-policy`, so a tool body may wait until the caller's signal aborts.
- The client half is one browser factory with no bundler. It already registers into `settings.section` through `ctx.slots.inject` (`lib/client.js:1528`) and talks to the host only through `/mcp-manager/api/*`.
- Both supported client versions (0.2.0-rc.2 web profile, 0.2.1-rc.5 desktop) declare `conversation.input.dock` as a `list` slot rendered inside the composer stack, above the composer card — the same place as the TODO and queue panels. Session-scoped slot components receive locale `t`, `sessionId`, `useSession` and `useSessions`.
- Constraints: zero dependencies, host `lib/index.js` plus focused modules, bilingual UI (`zh`/`en`), every user-visible change ships as an annotated release, tests are `node --test` with a stubbed context and real loopback MCP fixtures.

## Goals / Non-Goals

**Goals:**

- Add the waiting behavior without touching the OAuth core: discovery, registration, PKCE, scope selection, callback listeners, exchange, persistence and refresh stay exactly as they are.
- Put the new host state in one focused module with injected ports, so the wait, deadline, cancellation and abort rules are unit-testable without a plugin context.
- Make the recovery a single code path shared by direct tool calls, the on-demand broker and workspace servers.
- Surface the waiting state through one small, secret-free API that the conversation polls, independent from the heavier Settings poll.
- Keep the banner a pure consumer: no new host render, no DOM outside the slot, no new client dependency.

**Non-Goals:**

- Pushing state to the browser (SSE/WebSocket). The plugin's two halves already talk only through the same-origin JSON API; a 2-second poll of a tiny endpoint is enough and matches the existing Settings poll.
- Blocking connection-time failures, `static`/`stdio` servers, subagent lineage resolution, or cross-process wake-ups.
- Changing the Settings → MCP behavior, the authorize endpoints, or the callback subsystem.
- Sharing one poller between Settings and the banner in this change (see Risks / Trade-offs).
- Retrying a resumed call more than once, or retaining the failed call's arguments beyond the waiting entry.

## Decisions

### D1 — Two focused host modules under `lib/auth/`, ports pointing one way

```
+---------------------------+       +---------------------------------------+
| lib/index.js              |       | lib/auth/gate.js                      |
|  callWithAuthRecovery()   |------>|  createGate({ budgetMs, now, timers }) |
|  setServerAuthStatus()    |       |  block / authenticated / cancel        |
|  connect success          |       |  snapshot / dispose                   |
+-------------+-------------+       +---------------------------------------+
              |                     +---------------------------------------+
              +-------------------> | lib/auth/recovery.js                  |
                                    |  AuthRequiredError                    |
                                    |  withAuthRecovery({ call, gate, ... }) |
                                    |  authFailureMessage(server, outcome)   |
                                    +---------------------------------------+
```

- `gate.js` knows nothing about tools, transports or MCP servers. It stores attention entries keyed by a scope-aware server key and settles caller promises. Its contract: `block({ key, sessionId, reason, failureAt, signal })` resolves when the server is authenticated (or was authenticated after `failureAt`), rejects with a typed `timeout` / `cancelled` / `aborted` outcome; `authenticated(key)` notifies from the host; `cancel({ key?, sessionId })` settles selected callers; `snapshot()` returns the entries for the API. Timers and `now` are injected.
- `recovery.js` knows the call and the failure but not the transports: `withAuthRecovery({ call, gate, server, exec, onAuthRequired })` performs the first attempt, classifies an authentication failure, marks the connection, waits, and retries once. `AuthRequiredError` is the typed failure the transports throw; `authFailureMessage` is the only place the model-facing error text is built.
- `lib/index.js` keeps what it already owns: connection lookup, status, attempt log, authorization start/cancel, and the HTTP routes.

*Why*: this mirrors the `lib/oauth/*` split and keeps the wait rules testable with a fake clock and a fake signal. The alternative — putting the waiters and the retry inside `lib/index.js` — would grow the file by roughly the size of the OAuth callback subsystem and make every timer/cancel rule reachable only through a full plugin mount.

### D2 — A typed authentication error, thrown by every transport

`mcpRpc` and `sseSessionPost` replace their `401`/`403 insufficient_scope` throws with `AuthRequiredError` (`{ reason, kind: 'unauthorized' | 'insufficient-scope' }`) whose `message` stays the technical text (`MCP tools/call HTTP 401: invalid_token`). `insufficientScopeError` keeps producing the same information and gains the same marker.

The SSE POST path also gains the refresh-and-retry that `mcpRpc` already performs, so both transports agree on when a token refresh can still save the call. Without that, an ordinary expiry on an HTTP-with-SSE server would block for a human that a refresh would have made unnecessary.

*Why typed*: the call path must distinguish an authentication failure from every other transport error without matching message strings, and `connect()` already needs the same signal (`error.authRequired`) to keep setting `needs-auth`.

*Alternative considered*: string matching on `HTTP 401` in `recovery.js`. Rejected — a provider message can contain that text, and the middleware would depend on wording that is free to change.

### D3 — The wait sits in the call closure, not in the tool definition

`registerToolsGlobal` and `registerWorkspaceTools` build the `call` closure passed to `makeToolDefinition`; that closure is the one place every path funnels through (direct call, broker dispatch, workspace). It becomes:

```
call(name, args, exec) -> withAuthRecovery({
  call: () => currentConn(server).handle.call(name, args),
  gate, server, exec,
  onAuthRequired: (cause) => noteAuthFailure(server, cause),
})
```

`makeToolDefinition.execute` forwards its `exec`. The broker already forwards `exec.signal` into the nested `ctx.tools.execute`, so a broker-dispatched call inherits cancellation and the same recovery path.

`currentConn(server)` is new: both tiers resolve `live.get(server.id)` / `workspaces.get(path).servers.get(name)` at attempt time. This is not cosmetic — `connect()` replaces the connection object after a reauthorization, and a retry through the captured object would hit a closed handle.

*Alternative considered*: wrapping `handle.call` when the connection opens. Rejected — the handle is re-created on reconnect, so the wrapper would be lost exactly when it is needed, and the wrapper would then have to be re-installed in three places.

### D4 — Attention is recorded only by the gate, never derived from connection status

`noteAuthFailure` writes the status (`needs-auth`, with the reason) and the attempt log, but does not itself create an attention entry. Only `gate.block` does. That is what makes the listing mean "calls are waiting" rather than "a server is unhealthy", which is the scope decision in `mcp-auth-recovery`.

A connection that is `needs-auth` without a waiting call therefore stays visible only in Settings → MCP, exactly as today.

### D5 — Budget of 120 seconds by default, per waiting server

One entry per server key carries the deadline (`failureAt + budget`) and every caller waiting on that server shares it. The gate arms one timer per entry; settling the entry clears it. The retry after authentication starts a fresh MCP call with the normal per-server tool-call timeout — the wait budget never applies to a retry once it has begun.

The default lives in the plugin `Config` as `authWaitMs` (default `120000`, floored to `1000`, same normalization style as `toolCallTimeoutMs`). This is the rule the project already applies to tunables, and it lets the test suite use a short budget instead of waiting two minutes.

*Why per server and not per call*: a single authorization resumes every waiting call of that server, so a second call arriving mid-wait must share the deadline of the first; otherwise a burst of calls would keep extending the wait indefinitely.

*Alternatives considered*: a 10-minute budget (rejected: the operator decision was 2 minutes, and a full turn parked for 10 minutes is worse than a clear error); an unbounded wait (rejected: a forgotten turn would park the session forever).

### D6 — Resume is triggered by a successful reconnect, observed in one place

After `connect()` / `reconnectWorkspaceServer()` registers tools for a server, the host calls `gate.authenticated(key)`. That covers every way a reauthorization can arrive — the conversation banner, Settings → MCP, a workspace row, and tokens adopted from another process — without the gate knowing where the authorization started.

`authenticated(key)` records `lastAuthAt` even when nothing is waiting. `block` compares `lastAuthAt > failureAt`, so an authorization that completes in the gap between the failed attempt and the block (or a reauthorization that happened just before) resumes immediately instead of waiting for a timeout.

If the reconnect fails, `authenticated` is not called; the callers keep waiting and end with the timeout error. The failure itself is already reported by the existing status/attempt-log paths.

### D7 — Cancellation releases only what belongs to the caller, and the flow only when nobody else needs it

`POST /attention/cancel { sessionId, serverId }` settles the waiters of that session and server. The pending authorization flow for the server is released through `cancelSessionsFor(serverId)` **only when no other waiter for that server remains**, so cancelling one conversation cannot abort a flow another conversation is still waiting on. Stored configuration and tokens are untouched.

*Alternative considered*: cancel by attention entry id. Rejected for now — the entry is server-scoped and the client already has the session and the server id; adding an opaque id would be state the client would have to carry.

### D8 — Abort is part of the gate's contract, not a special case in the tool

Every `block` call attaches to `exec.signal` (guarded for tests that call `execute` without a second argument). On abort the gate removes the waiter and rejects with an `aborted` outcome; the host releases the pending flow when it was the last caller for that server. `recovery.js` rethrows a cancellation-shaped error, which the harness turns into an interrupted tool result. Nothing retries after an abort.

### D9 — The attention API is small, read-only and time-relative

`GET /mcp-manager/api/attention` returns:

```
{ items: [ { serverId, sessionId, scope: 'global'|'workspace', workspacePath,
             name, reason, error, phase: 'needs-auth'|'authorizing',
             pending, remainingMs } ] }
```

`error` is the failure text of the last authorization attempt for that server (empty when none failed). The gate records it through `failed(key, detail)` when a callback or a reconnect fails and clears it when a new authorization starts; it never settles callers.

`remainingMs` is computed host-side at response time, so the countdown does not depend on the browser's clock. `phase` is `authorizing` when at least one pending authorization session exists for that server (`authSessions.pendingFor`), which the gate can read through an injected port; this keeps the banner from guessing from the local "I clicked" state.

Reading the endpoint calls `gate.snapshot()` plus that port only — no disk read, no listener, no attempt entry.

### D10 — The banner is a `conversation.input.dock` entry that polls its own contract

The client registers:

```
ctx.slots.inject('conversation.input.dock', () =>
  ctx.slots.register({ name: 'conversation.input.dock', id: 'mcp-manager-auth', order: 10, locale: 'mcp' }, AuthBanner))
```

- `order: 10` places it between the TODO panel (`0`) and the message queue (`20`).
- The component filters `items` by `sessionId === props.sessionId`. That is also what scopes a workspace server: a workspace entry is registered only into agents of its own workspace, so a row owned by this session is the only workspace row this conversation can show. The listing still carries `scope` and `workspacePath` for display and diagnostics.
- Polling: fetch once on mount, then every 2 seconds; a separate 1-second tick re-renders the countdown from `remainingMs` captured at the last fetch. Both intervals are cleared by the effect. A per-effect `cancelled` flag drops responses that arrive after unmount or a session switch, the same pattern the Settings content already uses.
- No `useRef`/`useMemo`: the test harness models only `createElement`, `useState`, `useEffect` and `useCallback`, and the component can be written without them.

*Why a separate poller*: the Settings content polls `/servers` + `/workspaces` every 3 seconds, and `/workspaces` reads workspace files from disk. Reusing it would tie a chat surface to a page that may not be mounted and would make the banner wait for a heavier response. The attention payload is tiny and computed from memory.

*Alternatives considered*: `tool.call.toolview` for `mcp_execute_tool` (rejected: it replaces the generic tool row, does not cover direct `mcp__*` calls, and does not cover a call that is still running); `conversation.chat.turnTail` (rejected: it arrives only after the turn closes, which is the opposite of unblocking it); `conversation.composer.dock` (rejected: below the composer card, less visible, and it shares the row with the context meter).

### D11 — One start-authentication helper, and a fallback when the browser window is blocked

The two duplicated `startAuth` functions in `ServerRow` and `WorkspaceServerRow` (`lib/client.js:626`, `:866`) move into one helper that takes the server, its scope and the workspace path. The banner and both settings rows use it.

The helper calls the existing endpoint, then `window.open(authorizeUrl, '_blank')`. The desktop shell routes any `http(s)` window to the system browser (`setWindowOpenHandler` → `shell.openExternal`), which is what makes the loopback callback work. If `window.open` returns `null` (a browser popup policy), the row keeps the returned URL and renders it as an explicit "open the authorization page" link instead of failing the flow.

*Alternative considered*: a `GET` redirect endpoint so the action is a plain anchor. Rejected for this change: it would add a state-changing `GET` and a ticket mechanism to replace code that already works in the shipped desktop and web surfaces.

### D12 — The error text is built once, from a fixed vocabulary

`authFailureMessage(server, outcome)` renders the model-facing error for every wait outcome:

- `timeout`: the budget expired without a completed authorization.
- `cancelled`: the operator cancelled the wait.
- `disabled`: the server was disabled or removed while the call waited.
- `retry`: the retried call was rejected again with an authentication failure.
- `no-auth-flow`: the server cannot be reauthorized in a browser.
- `aborted`: not used for a model-facing message; the abort surfaces as an interruption.

A failed authorization attempt (the provider returned an error, the exchange failed, or the reconnect failed) does not settle callers: the gate records the failure text for the banner and the callers keep waiting until they resume, are cancelled or reach the budget.

Every variant names the server, states that the call was not executed, and points at the conversation banner and Settings → MCP. Provider-supplied reasons pass through the existing redactor before they are embedded.

### D13 — Testing seams

- `test/auth-gate.test.js`: fake clock/timers, fake abort signals — budget, shared deadline, `authenticated` before `block`, cancel scoping, abort, snapshot purity.
- `test/auth-recovery.test.js`: a fake `call` that fails N times — immediate retry after refresh, blocking, single retry, retry failure, static server refusal, error text and redaction.
- `test/auth-blocking.test.js`: reuses `test/helpers/oauth-harness.js` (a real loopback MCP + authorization server with token revocation) and extends it with a refresh-rejecting mode, so a revoked token cannot be repaired by a refresh. The test mounts `apply()`, connects an OAuth server, revokes the token, starts a tool call and observes it waiting; then it runs the normal authorization (start + delivered callback), asserts the same call resumes with its original arguments and succeeds, and that the attention listing is empty afterwards. Timeout, Cancel and ESC are driven through the same fixture.
- `test/attention-api.test.js`: the two endpoints through the stub `webServer` handler, including the absence of secrets and of non-waiting servers.
- `test/client-chat-auth.test.js`: the banner over the real `lib/client.js` factory — filtering by session/workspace, the three phases, Authenticate, Cancel, disappearance, and both locales. Requires extending `test/helpers/client-harness.js` to record more than one slot registration (today it keeps the last `spec`/component only).

## Risks / Trade-offs

- **A parked turn can look frozen** → the banner states that a call is waiting, shows the countdown, offers Cancel, and the turn always ends within 120 seconds; ESC aborts immediately.
- **Two-minute budget may be tight for SSO/MFA** → a slower authorization still completes and benefits the next call; the row stays actionable while the browser is open, and the deadline is a per-server decision that can be revised without touching the contract.
- **Popup blocked** → the row keeps the authorization URL and shows it as a link; no state is lost.
- **Two DSH processes on one profile** → the process that did not start the authorization does not observe the reconnect; its waiting call ends with the timeout error. Accepted and documented; a shared process signal is out of scope.
- **A subagent's call has no visible banner** → the call ends with the timeout/cancel error and the parent turn continues; resolving lineage to the root conversation was rejected as fragile.
- **Polling cost** → one `GET /attention` per open conversation every 2 seconds against an in-memory endpoint, no disk reads. Sharing a poller with Settings is a possible follow-up, not needed for this behavior.
- **A long wait blocks unrelated tool calls in an exclusive tool group** → MCP tools that are not concurrency-safe already serialize; a waiting call behaves like a slow call. No new scheduling is introduced.
- **Status can flap** → `noteAuthFailure` only moves a connection to `needs-auth`; the existing reconnect/backoff rules still own the transitions, and a successful reconnect clears the waiting entry.
- **Banner copy drift between languages** → every key goes into both dictionaries and the client test asserts both languages render the banner.

## Migration Plan

No persisted data changes: no new state-file key, no token shape change, no cache version. The feature activates only when an authenticated call actually fails.

1. Land the host modules and the transport error typing behind no flag; behavior without an authentication failure is unchanged.
2. Register the API routes and the banner slot; a client older than the host simply never calls the new endpoints.
3. Release 0.21.0 with the READMEs, `AGENTS.md` and a release note; rollback is reinstalling the previous version (no data to undo).
4. Verify in a disposable web profile against a mock MCP server that returns `401` after a connection is established: the call parks, the banner appears, an authorization completes, the call resumes with the same arguments, and the banner disappears. Also verify timeout, Cancel, ESC, and that Settings → MCP still reauthenticates normally.

## Open Questions

- Whether to share the attention poll with the Settings content later (performance refinement; does not change the contract or the tasks).
- Exact localized wording of the banner heading and row sentences (can be tuned after the first review without changing behavior).
