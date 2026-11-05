# Tasks

## 1. Foundations

- [x] 1.1 Create `lib/auth/gate.js` exporting `createAuthGate({ budgetMs, now, setTimeoutFn, clearTimeoutFn })` with `block`, `authenticated`, `cancel`, `snapshot` and `dispose`; verify `node -e "import('./lib/auth/gate.js').then(m => console.log(typeof m.createAuthGate))"` prints `function`.
- [x] 1.2 Create `lib/auth/recovery.js` exporting `AuthRequiredError`, `withAuthRecovery` and `authFailureMessage`; verify `node -e "import('./lib/auth/recovery.js').then(m => console.log(Object.keys(m).sort().join(',')))"` lists the three exports.
- [x] 1.3 Add `lib/auth` to `package.json` `files`; verify `npm pack --dry-run` lists `lib/auth/gate.js` and `lib/auth/recovery.js`.
- [x] 1.4 Implement and export `resolveAuthWaitMs(config)` (default `120000`, numeric strings accepted, floored, invalid values fall back to the default, minimum `1000`) and use it when the host creates the gate; verify a unit test in `test/auth-recovery.test.js` covers undefined, `0`, `-5`, `'2500'`, `999`, `NaN` and `300000`.

## 2. Gate semantics

- [x] 2.1 Implement `block()` creating one attention entry per server key with a single deadline shared by every caller; verify a unit test blocks twice on the same key and reads two per-session rows of `pending: 1` with one shared deadline.
- [x] 2.2 Implement the budget timer so every caller of an expired entry rejects with `timeout` and the entry disappears; verify a fake-timer test asserts both rejections and an empty snapshot.
- [x] 2.3 Implement `authenticated(key)` settling every caller of that server, clearing the entry and its timer, and recording `lastAuthAt`; verify a test asserts both callers settle and a later `snapshot()` has no entry.
- [x] 2.4 Implement the pre-block race: `block()` resolves immediately when a successful authentication for that key happened after `failureAt`; verify a test calls `authenticated` first and asserts `block` resolves without a timer tick.
- [x] 2.5 Implement `cancel({ key, sessionId })` settling only that session's callers and returning the count; verify a test keeps a second session's caller pending and asserts the returned count.
- [x] 2.6 Implement abort handling: an aborted `exec.signal` removes that caller, settles it as `aborted`, detaches its listener and drops the entry when it was the last; verify a test with an `AbortController` asserts the outcome and that no timer remains.
- [x] 2.7 Implement `dispose()` settling every caller as `cancelled`, clearing every timer and every listener; verify a test disposes with two waiting keys and asserts both settle and the snapshot is empty.
- [x] 2.8 Implement `snapshot()` returning the read-only shape (`serverId`, `sessionId`, `scope`, `workspacePath`, `name`, `reason`, `pending`, `remainingMs`) with no mutation and no secrets; verify a test asserts the exact keys, `remainingMs > 0`, that calling it twice does not change state, and that a `phaseOf` port reporting a pending flow yields `authorizing`.

## 3. Host wiring

- [x] 3.1 Replace the `401` throw in `mcpRpc` (and mark the `403` insufficient-scope error) with `AuthRequiredError`, keeping the existing technical message; verify `node --test test/sse-basic.test.js test/no-auth-mode.test.js test/oauth-scope.test.js` passes.
- [x] 3.2 Give `sseSessionPost` the same refresh-and-retry that `mcpRpc` performs on `401` (OAuth servers only) and throw `AuthRequiredError` when the refresh cannot repair it; verify a new SSE test revokes a token, lets the refresh issue a new one, and asserts the call returns without waiting.
- [x] 3.3 Record `needs-auth` from the call path through `noteAuthFailure(server, cause)` for both tiers, replacing the global-only marking in the insufficient-scope branch; verify a test asserts a global and a workspace server both report `needs-auth` after a rejected call.
- [x] 3.4 Add `currentConn(server)` resolving the live connection at attempt time and use it in both per-tier `call` closures; verify an integration test reconnects a server (config edit + connect) and asserts a tool call still executes.
- [x] 3.5 Forward `exec` from `makeToolDefinition.execute` into the `call` closure and wrap both closures with `withAuthRecovery({ call, gate, server, exec, onAuthRequired })`; verify a test executes a healthy tool and gets the same result as before (`node --test test/tool-timeout.test.js`).
- [x] 3.6 Call `gate.authenticated(serverKey)` after a successful global connect and after a successful workspace reconnect; verify a test authenticates a waiting call through the real authorization flow and asserts it resumes.
- [x] 3.7 Release the pending authorization flow on cancellation only when no waiter for that server remains; verify the two-session cancel test asserts the flow survives the first cancel and is released by the second.
- [x] 3.8 Dispose the gate when the plugin disposes; verify a test unloads the plugin with a waiting call and asserts the caller settles and no timer stays armed.

## 4. Attention API

- [x] 4.1 Add `GET /mcp-manager/api/attention` to the API router returning `{ items }` from `gate.snapshot()` plus the pending-flow port; verify a stub-`webServer` test asserts the status, the item shape and one entry per waiting server.
- [x] 4.2 Add `POST /mcp-manager/api/attention/cancel` accepting `{ sessionId, serverId }`, settling that session's waiters and releasing the flow only when nothing else waits; verify a test covers a cancelled session, an untouched sibling session and an unknown server id (no-op).
- [x] 4.3 Prove the listing is read-only and secret-free: verify a test asserts the attempt log is unchanged by a read and that no token, client secret or authorization URL appears in the payload (compare against the tokens the fixture issued).

## 5. Client

- [x] 5.1 Extend `test/helpers/client-harness.js` to record every slot registration (name, options, component) and expose them, keeping the existing single-slot helpers working; verify `node --test test/client-*.test.js` passes.
- [x] 5.2 Extract the duplicated `startAuth` in `ServerRow` and `WorkspaceServerRow` into one helper that takes the server, scope and workspace path, and use it from both rows; verify the existing client suites pass and `grep -c "async function startAuth" lib/client.js` prints `0`.
- [x] 5.3 Implement the `AuthBanner` component: fetch `GET /attention` on mount and every 2 seconds, filter by `sessionId` and the session `cwd` (global entries always pass), and render one row per server; verify a new `test/client-chat-auth.test.js` asserts the fetch and the filtered rows from a fetch stub.
- [x] 5.4 Render the row content: server name, scope distinction for equal names, reason, `pending` count and a `mm:ss` countdown from `remainingMs`; verify a unit test asserts the text for a row with two waiting calls and the countdown after a tick.
- [x] 5.5 Implement the three phases: `needs-auth` with Authenticate and Cancel, `authorizing` with the browser notice and no second Authenticate, `error` with the failure text and Authenticate available again; verify one test per phase.
- [x] 5.6 Implement Authenticate: call the shared helper for the row's scope, open the returned URL with `window.open`, and keep an explicit "open the authorization page" link when the returned window is falsy; verify a test stubs `window.open` returning `null` and asserts the link and the displayed failure path.
- [x] 5.7 Implement Cancel: post `POST /attention/cancel` with the session and server, dismiss the row, and keep the server configuration untouched; verify a test stubs the response and asserts the row disappears while no other request was made.
- [x] 5.8 Implement the polling lifecycle: 2-second fetch interval plus a 1-second countdown tick, both cleared on unmount and session switch, a `cancelled` flag for responses that arrive after the session changed, and stale rows cleared after two failed reads; verify a harness test asserts both intervals are cleared on unmount and another asserts that two failed reads drop the banner (the harness cannot model session-change effect re-runs, so the `[sessionId]` dependency is verified by inspection).
- [x] 5.9 Render nothing when the filtered list is empty and drop the banner as soon as a poll returns no item; verify a test starts with one item and asserts no output after the empty poll.
- [x] 5.10 Register the component with `ctx.slots.inject('conversation.input.dock', ...)`, `id: 'mcp-manager-auth'`, `order: 10` and `locale: 'mcp'`; verify the harness records both the Settings and the banner registration with those options.
- [x] 5.11 Add every banner string to both `zh` and `en` (heading, row reason fallback, waiting-call count, countdown label, phase notices, actions, start-failure text, accessible labels, authorization-page link); verify a test switches the language and asserts both dictionaries render with no key fallback.

## 6. Verification and release

- [x] 6.1 Extend `test/helpers/oauth-harness.js` with a refresh-rejecting mode so a revoked token cannot be repaired by a refresh; verify `node --test test/oauth-callback-flow.test.js` still passes in the default mode.
- [x] 6.2 Add `test/auth-blocking.test.js` covering the happy path: connect an OAuth server, revoke the token, start a tool call, observe the attention entry, run the authorization (start + delivered callback), and assert the same call resumes with its original arguments and succeeds; verify with `node --test test/auth-blocking.test.js`.
- [x] 6.3 Cover the timeout with `authWaitMs: 1000`: assert the call rejects with the actionable message, the attention entry is gone and the turn can continue; verify in the same suite.
- [x] 6.4 Cover Cancel and ESC: two sessions where one cancels while the other keeps waiting, and an aborted call that settles as interrupted without a retry and releases the callback port; verify with `canBindPort` in the same suite.
- [x] 6.5 Cover a workspace server blocked and resumed through `/workspaces/auth`, and assert the attention entry carries the workspace path; verify in the same suite.
- [x] 6.6 Cover a `static` server rejection: the call fails immediately with the actionable error and no attention entry appears; verify in the same suite.
- [x] 6.7 Run the full suite with `npm test` and fix every failure.
- [ ] 6.8 Verify in a disposable web profile against a mock MCP server that returns `401` after connect: the call parks, the banner appears above the composer, Authenticate completes, the call resumes and the banner disappears; also check the timeout, Cancel, ESC and that Settings → MCP still reauthenticates. Record the DSH version and the platform, and state any limitation.
- [x] 6.9 Update `AGENTS.md` with the `lib/auth/` layout, the wait/retry/cancel rules, the `authWaitMs` config, the attention endpoints and the rule that only waiting calls appear.
- [x] 6.10 Update `README.md` and `README.zh-CN.md` (both languages, same behavior) and add `docs/release-v0.21.0.md`.
- [x] 6.11 Bump `package.json` to `0.21.0`; verify `node -e "console.log(require('./package.json').version)"` prints `0.21.0`.
- [ ] 6.12 After the change is merged to `main`, create the annotated tag `v0.21.0` on the merge commit and push `main` and the tag; verify `git tag -n1 v0.21.0` shows the release summary and the tag points at the merge commit.
