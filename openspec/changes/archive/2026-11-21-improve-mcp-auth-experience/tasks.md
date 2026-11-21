# Tasks

## 1. Transport extraction (no behavior change)

- [x] 1.1 Create `lib/transport/http.js` with the HTTP transport factory and its port contract (`authHeadersFor`, `accessTokenFor`, `refreshToken`, `onAuthRejection`, `recordAttempt`, `redact`, `resolveTimeout`, `discoverMetadata`, `replug`, `log`), moving `mcpRpc`, `openHttp`, `openSse`, `sseSessionPost`, `authHeaders`, `ensureFreshToken`, `captureResourceMetadata` and `insufficientScopeError` out of `lib/index.js`; verify `npm test` passes with no test file edited
- [x] 1.2 Wire the ports in `lib/index.js` so the moved functions receive the host state instead of closing over it, and delete the moved definitions; verify `npm test` passes and `lib/index.js` no longer defines any of the moved functions
- [x] 1.3 Add `test/transport-port-contract.test.js` asserting the transport factory works against a stubbed port set with no plugin state; verify the new test passes and that removing a required port makes it fail

## 2. Dead-session detection and repair

- [x] 2.1 Implement the pure predicate `isDeadSession(status, body)` in `lib/transport/http.js` covering `404` and `400` bodies that name a session, and returning false for `401`, `403`, `5xx`, a `400` without session wording and an unknown-tool result; verify `test/transport-dead-session.test.js` covers all five positives and negatives measured from `database`, `observability` and `atlassian`
- [x] 2.2 Add the single-flight `replug(server)` port in `lib/index.js` reusing the existing reconnect machinery (close handle, reopen, register tools, notify the gate) and sharing the per-server reconnect slot; verify a test asserts two concurrent dead-session calls produce one reconnect
- [x] 2.3 Apply the repair in both HTTP transports: on a dead session, replug and replay the request once with the same method, name and arguments, surfacing the second failure unchanged; verify `test/transport-dead-session.test.js` asserts a successful replay, the tool list following the new session, the second-failure surface, and that no attention entry is created
- [x] 2.4 Make a replug rejected for authentication reuse the existing classification so the connection becomes `needs-auth` and the existing authorization path applies; verify a test asserts the status and that no dead-session retry loop occurs

## 3. Server card: state instead of diagnostics

- [x] 3.1 Add a `Reauthenticate` action to the shared card action row for every server whose `authMode` is `oauth` and whose type is not `stdio`, independent of status, reusing the one authorization helper; verify `test/client-language.test.js` asserts the action is present for a connected OAuth server and absent for a static-token and a stdio server
- [x] 3.2 Stop rendering the provider error text in the collapsed and expanded card bodies while keeping the attempt log as its only surface; verify tests assert no error text renders for a rejected token and that the log entry is still readable
- [x] 3.3 Render the insufficient-scope case as one neutral line naming the missing scope, with the authentication action stating that the new authorization grants it; verify a test asserts the neutral line and the scope-aware action label
- [x] 3.4 Extract `createAuthorizationAction({ request, open })` for the per-surface busy/error/link state and make `ServerRow` and `WorkspaceServerRow` use it; verify `npm test` passes and both rows contain no duplicated busy/error bookkeeping

## 4. Compact conversation banner

- [x] 4.1 Replace the banner geometry with the composer composition (composer max width minus dock insets, `--dsw-specific-menu`, `--dsw-elevation-panel`, `--dsw-radius-lg`) and drop the business tint; verify `test/client-chat-auth.test.js` asserts the compact classes and that no full-width or business-tinted surface remains
- [x] 4.2 Render at most three rows and fold the remainder behind an expandable summary stating how many are hidden; verify `test/client-chat-auth.test.js` covers three rows plus the summary, expanding it, and a single-row banner with no summary
- [x] 4.3 Show a row reason only when it is actionable (insufficient scope or a refused authorization) and omit provider token wording; verify `test/client-chat-auth.test.js` asserts both cases

## 5. Frame-wide authentication alert

- [x] 5.1 Register the alert into `shell.overlay` polling the existing `/attention` endpoint, and resolve the visible conversation from the persisted `dsh.sessions.current` with an unreadable value treated as no conversation visible; verify `test/client-auth-alert.test.js` covers own conversation, another conversation, and an unreadable selection
- [x] 5.2 Treat an `aria-modal="true"` surface in the document as the conversation not being visible, with a fallback to the selection-only rule when the observer or attribute is unavailable; verify `test/client-auth-alert.test.js` asserts the alert shows over a modal and still degrades safely
- [x] 5.3 Render one card per wait naming the server and the owning conversation title from the session list, degrading to the server name alone when the title is unreadable; verify a test asserts both labels
- [x] 5.4 Offer `Go to conversation` through the guarded workspace navigation service and `Authenticate` through the shared authorization action without navigating away, preventing a second flow and reporting a failed start inside the alert; verify `test/client-auth-alert.test.js` covers navigation, authentication, no-second-flow and failed start
- [x] 5.5 Keep the alert for as long as its wait exists, allow dismissal without settling the wait, restore it for a later wait of the same server, and clear it when the wait settles; verify a test covers all four transitions
- [x] 5.6 Bound the visible alerts at three with an expandable summary for the remainder and stable ordering across updates; verify a test asserts the bound, the expansion and the ordering

## 6. Release

- [x] 6.1 Bump `version` to 0.23.0 in `package.json` and update `README.md` and `AGENTS.md` with the transport module, the dead-session repair, the compact banner, the alert and the card changes; verify the documented layout matches the files on disk and `npm test` passes
- [x] 6.2 Run the full suite and verify every pre-existing test still passes, including `test/auth-blocking.test.js`, `test/attention-api.test.js` and `test/oauth-callback-flow.test.js`
- [x] 6.3 Verify the change end to end in a disposable web profile against a loopback MCP server whose session can be invalidated: `scripts/verify-auth-experience-dsh.mjs` boots the real launcher, invalidates the session and asserts a call hitting it still succeeds with no authentication wait, authorizes a second server and revokes its credential to park a real wait, and reads the frame-wide alert from the real GUI in Chromium — exit 0, every step green, and it exits 1 on the exact `404 Session not found` when the repair is removed.
  - Deferred, and covered by the client suites instead of the real host: the conversation banner in a real app frame, and activating either alert action from the browser. Both need a saved session and a completed authorization inside the browser, which the disposable run does not create. `test/client-chat-auth.test.js`, `test/client-banner-compact.test.js` and `test/client-auth-alert.test.js` render the real components for those paths.
  - Deferred, needs a host-supported layer: the alert outranking a host-owned top-layer surface. The host overlay slot is a `z-index:20` layer, so a modal it promotes covers the card. The spec states this constraint.
- [x] 6.4 Verify `git diff --cached | grep -n '^\ No newline at end of file'` prints `ok`, then commit on the branch and create an annotated tag
