# Design

## Context

See `proposal.md` - Why. The behavior this design must produce is in the four spec deltas under `specs/`.

Current state that shapes the approach:

- `lib/index.js` is ~5,100 lines. The HTTP transports (`mcpRpc`, `openHttp`, `openSse`, `sseSessionPost`, `authHeaders`, `ensureFreshToken`, `captureResourceMetadata`, `insufficientScopeError`) live inside it, interleaved with plugin state: 19 references to `ctx`, 12 to `live`, 7 to the tool registration, 5 to `refreshTokens`, 5 to `recordAttempt`, 4 to `state` and 4 to `redactDetail` in that range alone.
- `lib/auth/gate.js` already owns the waiters, the deadline, cancellation and the read-only attention snapshot; `lib/auth/recovery.js` owns `AuthRequiredError` and the single retry after a wait. Both take injected ports and know nothing about transports.
- `lib/tools/registration.js` owns the definition builder and the tier-agnostic synchronization. It resolves the live connection at attempt time, so a reconnect does not stale a registration.
- `mcpRpc` refreshes once on `401` and throws `AuthRequiredError`, but treats a `404` and a client-error `400` as ordinary failures: no reconnect, no retry, and the connection stays `connected`, so every later call repeats the same failure. Measured against the operator own servers: a Streamable HTTP server answers `404 {"code":-32600,"message":"Session not found"}` for an expired `Mcp-Session-Id`, and `400 "Bad Request: Missing session ID"` when none is sent; a server that ignores session identifiers is unaffected; a rejected token answers `401`.
- The conversation banner registers into `conversation.input.dock` and renders with `width:100%`, a `color-mix` business tint and a business border, while the composer and its sibling docks (Todo, Queue, Goal) use `--dsh-composer-card-max-width`, `--dsw-specific-menu`, `--dsw-elevation-panel` and `--dsw-radius-lg`. It also renders every waiting server with no bound.
- `shell.overlay` is a `kind: list`, `scope: root` slot declared by the layout package: a click-through floating layer outside every column scroll container, with no owner props. It receives no session identity, and the client store exposes only the session list, not the current selection. The selection lives in the application own persisted store under the key `dsh.sessions.current`, written as plain JSON on every navigation.
- `conversation.input.dock` receives `sessionId`, which is what scopes the banner today.
- The plugin client half is one hand-written module factory with no bundler and no JSX; every string lives in one English table resolved through its own `t`.
- Constraints: zero dependencies, plain modern JavaScript, per-file modules under `lib/*`, `node --test` with a stubbed context and real loopback fixtures, and an annotated release tag per user-visible change.

## Goals / Non-Goals

**Goals:**

- Move the HTTP transports out of `lib/index.js` behind a narrow port interface, so the dead-session rule has one implementation and one test surface.
- Keep every existing behavior of the wait, the retry, the attention listing and the callback subsystem exactly as it is.
- Give the client one authorization action that the card, the banner and the frame-wide alert all call, so a fourth surface cannot grow a fourth copy.
- Keep the compact banner and the new alert visually inside the composer own design family instead of inventing a second one.

**Non-Goals:**

- Extracting the stdio transport. It has no session and no HTTP status, so the dead-session rule does not apply to it, and moving it would add risk without serving this change.
- Extracting the OAuth core (discovery, registration, PKCE, exchange, listeners, refresh). It is already modular under `lib/oauth/*` and nothing here changes it.
- Pushing state to the browser. Both halves keep talking through the same-origin JSON API; the alert polls the existing attention endpoint.
- A public selection API in the framework. The alert reads the persisted selection instead.
- Retrying a dead-session call more than once, or replaying a call whose transport already accepted it.
## Decisions

### D1 - The transport becomes a module with injected ports

```
lib/index.js (composition root)            lib/transport/http.js
+--------------------------------+         +----------------------------------+
| live / state / registration    |  ports  | openHttp  openSse  mcpRpc        |
| status classification          |-------->| sseSessionPost  authHeaders      |
| attempt log / catalog          |         | deadSession detection            |
| refresh + token access         |         | refresh-once-on-401              |
+--------------------------------+         +----------------------------------+
```

The module exports a factory that receives what it needs instead of reaching into plugin state:

- `authHeadersFor(server, handle)` and `accessTokenFor(server)` - credentials.
- `refreshToken(server)` - the one-shot refresh, which must stay single-flight in the host.
- `onAuthRejection(server, cause, phase)` - records the status and the attempt entry.
- `recordAttempt(server, entry)` - the attempt log.
- `redact(text)` - the redactor, applied before anything is stored.
- `resolveTimeout(server)` - the per-server tool-call budget.
- `discoverMetadata(server)` - discovery for the resource-metadata cache.
- `replug(server)` - rebuilds the connection after a dead session and re-syncs the tier tools.
- `log` - `ctx.logger` behind a small face.

*Why*: this is the pattern `lib/auth/recovery.js` and `lib/tools/registration.js` already use in this repository, so it needs no new concept. The alternative - keeping the transports in `lib/index.js` and adding the dead-session rule there - was rejected because the rule has to serve both HTTP transports and both tiers, and inside a 5,100-line file it would be reachable only through a full plugin mount.

*Alternative considered*: a `fetch` wrapper that retries transparently. Rejected: the retry must also re-initialize the session and re-list tools, which a fetch wrapper cannot see.

### D2 - One pure predicate decides what a dead session is

```js
isDeadSession(status, body) -> boolean
```

It answers true only when:

- `status === 404` and the body or status text names a session (`session` in the JSON-RPC error message, the `error` field, or the plain body), or
- `status === 400` and the body or status text names a session.

Everything else is false, including an unknown tool (`200` with `isError`), an invalid payload (`400` without session wording), an authentication rejection (`401`, `403`) and a server error (`5xx`). Measured reasons this shape is right: the observed bodies are `Session not found`, `Bad Request: Missing session ID` and `Request must be an initialize request if no session ID is provided`; all three contain the word, and no unrelated client error does.

It is a pure function over the response, so it is unit-testable with fixtures from all three servers without a network.

### D3 - The repair reconnects, then replays once

```
call(name, args)
  |
  +--> attempt #1 ----------------------------> result
  |       |
  |       +-- dead session and a replug port is available
  |              |
  |              v
  |        replug()  -> host closes the handle, reconnects,
  |                     re-syncs the tier tools
  |              |
  +--> attempt #2 (same args, new handle) -----> result
  |       |
  |       +-- dead session again -> surface the failure
  v
surface
```

`replug` is the port the host implements, and it is the same operation a reconnect already performs: close the old handle, open the server, register the tools, notify the gate. Reusing it is what makes the tool list follow the new session for free.

A concurrent burst must not trigger a reconnect storm: the replug is single-flight per server key, and a call that finds a replug already running waits for it and then retries instead of starting its own.

*Alternative considered*: making the retry live in `withAuthRecovery`. Rejected: that module exists for human-driven authorization and its contract is a wait plus one retry; folding a machine-repairable case into it would make every future reader think a call can wait for a dead session.

### D4 - The reconnect is what already exists, not a second path

The host exposes one `replug(server)` built on the reconnect machinery it already owns. It takes the per-server single-flight slot the reconnect timers already use, so a dead session during a scheduled backoff does not produce two connects. When the replug fails with an authentication error, the existing classification turns the connection into `needs-auth` and the existing recovery applies: there is no new error vocabulary for that case.

*Why*: a second reconnect path is exactly the kind of duplication this change is meant to remove.
### D5 - The alert lives in the frame overlay and reads the persisted selection

```
+-----------------------------------------------------------+
| shell.overlay  (scope: root, click-through)               |
|                                                           |
|   [ MCP authentication required                  ] [x]    |
|   [ database - "Trip planning"                     ]      |
|   [ Go to conversation ] [ Authenticate ]                 |
+-----------------------------------------------------------+
```

`shell.overlay` is the only seat that exists on every screen, is outside every scroll container, and is deliberately generic (its catalog entry names a toast stack as a legitimate occupant). It is click-through, so an entry opts back into pointer events.

The layer receives no session identity, so the alert resolves which conversation is on screen from the application persisted selection (`dsh.sessions.current`, whole-value JSON). Three rules keep that honest:

1. A selection that cannot be read is treated as no conversation visible, so the alert shows. Showing an extra alert is the safe direction; hiding a real one is not.
2. The alert opens `Go to conversation` by calling the workspace navigation service the application exposes for this purpose, guarded so an absent service degrades to no navigation action rather than an error.
3. A modal surface counts as the conversation not being the surface being acted on: the check also looks for an `aria-modal="true"` surface in the document.

The conversation title for the alert is resolved on the client from the session list the layer already receives; no host field is added. A session with no readable title renders the server name alone.

*Alternatives considered*: `conversation.input.overlay` receives `sessionId` for free but exists only inside a conversation, which defeats the purpose; always showing the alert duplicates the banner in the owning conversation.

### D6 - One authorization action for every surface

```js
createAuthorizationAction({ request, open }) -> {
  start(server, scope, workspacePath) -> { opened, authorizeUrl },
  busy, error, link            // per-row view state
}
```

The existing `requestAuthorization` and `startAuthorizationAction` already hold the endpoint choice and the `window.open` handling; the card, the banner and the alert each add their own busy/error/link bookkeeping. The extraction keeps the request and open semantics identical and moves the view state into one small helper the three surfaces call, so the alert does not become the fourth copy of the error handling.

*Alternative considered*: a full `useAuthorization` hook. Rejected: the client half has no bundler and the test harness models only `createElement`, `useState`, `useEffect` and `useCallback`; a plain factory is both simpler and directly testable.

### D7 - The banner borrows the composer own geometry

The banner stops declaring its own width, surface, border and radius and instead reuses the composer existing composition: the composer maximum width minus the dock insets, `--dsw-specific-menu` with its backdrop filter, `--dsw-elevation-panel` and `--dsw-radius-lg`. The business tint disappears; the accent moves to the status dot that already exists in the row.

Folding is a local view concern: the first three rows render, and a summary row carries the count of the rest behind an expand affordance. The cap is a constant in the module, not a host setting.

### D8 - The card separates state from diagnostics

The card renders the status control, the scope line when one applies, the tool list and the action row. The server error field stops being rendered as a red line in both the collapsed and expanded bodies; the attempt log, which already fetches on expand, remains the only place provider text appears. The insufficient-scope case keeps one neutral line and changes the authentication action label to say the new authorization grants the scope, because the remedy genuinely differs.

`Reauthenticate` is added to the action row for every server whose authentication mode is OAuth and whose type is not stdio, independent of status, so an operator can renew before a rejection.

### D9 - Testing seams

- `test/transport-dead-session.test.js`: the pure predicate against the three measured bodies plus the negatives; then a loopback MCP server whose session can be invalidated, asserting the call succeeds after one reconnect, the tool list follows the new session, a second failure surfaces, and no attention entry is created.
- `test/transport-port-contract.test.js`: the transport module against a stubbed port set, asserting it never reaches for global state (the same shape `test/auth-recovery.test.js` uses).
- `test/client-auth-alert.test.js`: the alert over the real `lib/client.js` factory - visibility rules (owning conversation, another conversation, modal open, unreadable selection), the two actions, dismissal semantics, the visible bound and stable ordering.
- `test/client-chat-auth.test.js`: rewritten for the compact card and the folding summary.
- `test/client-language.test.js`: extended for `Reauthenticate` and the neutral scope line; the existing Authentication required assertion stays.

## Risks / Trade-offs

- **Extracting the transport touches the most-used code path in the plugin** -> Land it in the order of `tasks.md`: transport extraction first with no behavior change, dead-session detection second, UI third. Every stage leaves the suite green, and the extraction stage must not modify a single observable behavior.
- **Reading the application persisted selection is coupling to an implementation detail** -> Treat an unreadable or unparseable value as no conversation visible, which shows the alert rather than hiding it. No host state is duplicated and no framework API is required.
- **Detecting a modal through the DOM is fragile** -> The check is advisory: without a `MutationObserver` or without the attribute, the alert falls back to the selection-only rule, which is the behavior already agreed.
- **A reconnect storm on a server whose session dies repeatedly** -> The replug is single-flight per server key and the replay happens at most once per request, so a broken server produces one reconnect per burst, not one per call.
- **A rebuilt session can change the tool set mid-turn** -> That is the intent (the spec requires it), but it means a tool can disappear between two model calls in one turn. The registration synchronization already handles a shrinking set by disposing stale registrations, and the model receives the harness ordinary unknown-tool error if it insists.
- **The alert layer competes with the application own transient notices** -> The visible bound is three and the layer is click-through; the alert uses the same top-center region as the application toasts, so a burst of both is possible. Accepted for now; the alert could be anchored elsewhere later without changing its contract.
- **Provider text leaving the card hides a diagnosis the operator previously saw** -> The attempt log is one click away on the same card and the scope case stays visible; the release notes call this out.

## Migration Plan

No persisted data changes: no new state-file key, no token-shape change, no catalog version, and the dead-session repair is stateless.

1. Land the transport module and the port interface with no behavior change; the existing suites must pass untouched.
2. Add the dead-session predicate and the replug-and-replay step with its new tests.
3. Rework the card (status control, Reauthenticate, no provider text, neutral scope line) and its tests.
4. Replace the banner geometry and add the folding summary.
5. Add the frame-wide alert on `shell.overlay` with the shared authorization action.
6. Bump to 0.23.0, sync `README.md` and `AGENTS.md`, commit, and tag annotated.

Rollback is reinstalling the previous version: no data has to be undone.

## Open Questions

- Whether the alert should later be anchored away from the top-center region to avoid sharing it with the application transient notices. Deferrable: it changes neither the capability nor the tasks.
