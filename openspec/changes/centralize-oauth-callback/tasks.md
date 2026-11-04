# Tasks

## 1. Foundations

- [x] 1.1 Create `lib/oauth/` with `callback-manager.js`, `redirect-resolver.js`, `session-store.js` and `callback-page.js`, each exporting its public functions with no imports from `lib/index.js`; verify `node -e "Promise.all(['callback-manager','redirect-resolver','session-store','callback-page'].map(m => import('./lib/oauth/'+m+'.js')))"` resolves.
- [x] 1.2 Add the new files to `package.json` `files` so a published package ships them; verify `npm pack --dry-run` lists every `lib/oauth/*.js` entry.
- [x] 1.3 Implement the shared loopback predicates and URI formatting (`isLoopbackHostname`, `requiredFamilies`, bracketed IPv6 authority) in `redirect-resolver.js` and reuse them from `ensureClientId` instead of its duplicated regex; verify unit tests cover `localhost`, `127.0.0.1`, `127.9.9.9`, `::1`, `[::1]` and a public hostname.

## 2. Redirect resolution

- [x] 2.1 Implement callback path parsing and normalization (must start with `/`; reject `?`, `#`, `..`, backslash and control characters; collapse duplicate slashes); verify `node --test test/oauth-redirect-resolution.test.js` covers each rejection and `/oauth/return`.
- [x] 2.2 Implement complete-URI override parsing (`scheme://host[:port][/path]`, `http` only, loopback host only, no query/fragment/userinfo); verify tests assert each rejection message names the reason.
- [x] 2.3 Implement `resolveRedirect` precedence and inheritance (override → global fixed → automatic; omitted port/path inherit the fixed globals, otherwise automatic port and `/callback`); verify a table-driven test covers every combination.
- [x] 2.4 Implement the unservable stored value outcome: a non-loopback or `https` stored override throws a typed error, produces no URI and never falls back; verify the test asserts the throw and that the input value is not mutated.
- [x] 2.5 Route `parseOauthFields` validation of `redirectUrl` through the new parser so save-time and flow-time rules cannot diverge; verify the existing OAuth field tests still pass with the new accepted and rejected values.
- [x] 2.6 Implement global callback configuration validation (mode, loopback hostname, required port in fixed mode, normalized path) without binding anything; verify tests cover automatic defaults, a missing fixed port, an invalid host and a port outside 1-65535.

## 3. Session store

- [x] 3.1 Implement `SessionStore` with `create`, `consume`, `pendingFor`, `expire`, `clear` and an injectable clock; verify the store test creates a session and consumes it once.
- [x] 3.2 Implement single-use and replay reporting with tombstones (`ok`, `consumed`, `expired`, `unknown`); verify tests cover a replayed state, an expired state and an unknown state.
- [x] 3.3 Store the full session context (server and workspace identity, client identity, resolved redirect URI, verifier/challenge, state, expiry, status); verify a test asserts the exact context returned by `consume`.
- [x] 3.4 Verify concurrent sessions for different servers and for the same server stay independent and that `pendingFor(serverId)` reports them all without cross-contamination.

## 4. Callback manager

- [x] 4.1 Implement the listener pool: `acquire({host, port, path, onRequest})` and `release()`, one port per listener, a per-listener path table and reference counting; verify the manager test serves two paths on one port and frees the port after both are released.
- [x] 4.2 Implement automatic allocation that binds IPv4 on port 0 and widens to `::1` on the same port, marking the listener IPv4-only when the IPv6 bind fails; verify tests cover the both-families case and the IPv4 fallback.
- [x] 4.3 Implement typed bind failures for a fixed port (`EADDRINUSE`, `EACCES`, `EADDRNOTAVAIL`) with no fallback port; verify the test asserts the error carries the port and cause and that no URI was produced.
- [x] 4.4 Implement request handling: exact normalized path match, `GET` only, `404` for an unregistered path and `405` for another method; verify tests hit a live listener with `node:http` and assert the statuses.
- [x] 4.5 Implement `closeAll()` and confirm it closes every socket of every listener; verify a test rebinds the same fixed port immediately after `closeAll()`.
- [x] 4.6 Implement `status()` returning each listener's address, port, registered paths and pending count; verify a test reads it while two flows are registered.

## 5. Host integration

- [x] 5.1 Rewrite `startAuth` as `startAuthorization(server)`: resolve the redirect, discover metadata, ensure the client id for that exact URI, acquire the listener and register the path, create the session, and only then build the authorization URL; verify the end-to-end test receives an authorization URL whose redirect URI port already accepts a connection.
- [x] 5.2 Implement `completeAuthorization(session, params)`: reject a mismatched or unknown state, handle a provider `error`, exchange the code with the session's own client identity, redirect URI and verifier, persist, then reconnect the connection; verify the end-to-end test completes a flow through a real callback request.
- [x] 5.3 Replace the per-server `pending` map with the session store everywhere (start, exchange, status) and delete the old lookup; verify `grep -n "pending\.\(get\|set\)" lib/index.js` returns no authorization-flow hit and the OAuth suites pass.
- [x] 5.4 Release the session and its listener on success, provider error, exchange failure and expiry; verify tests assert the port is free after each outcome.
- [x] 5.5 Drive expiry from a timer plus the lazy check on consume, and move the connection status back to `needs-auth` when the last session for it expires; verify the test advances the injected clock and observes both the status and the released port.
- [x] 5.6 Cancel a connection's pending sessions when the server is deleted or disabled; verify a test starts authorization, deletes the server, and asserts no session remains and the port is released.
- [x] 5.7 Close every listener and clear the store in the plugin teardown hook; verify the unload test asserts the fixed port is bindable afterwards.
- [x] 5.8 Unify `POST /servers/:id/auth` and `POST /workspaces/auth` on `startAuthorization(server)`; verify both API tests still return an authorization URL and that a global and a workspace server can authorize concurrently.
- [x] 5.9 Remove the GUI callback route and derive nothing from the request: delete `browserOrigin`, `publicOriginsOf`, `allowedPublicOrigins`, `localGuiPort`, `portOfOrigin`, `normalizeLoopbackHost`, `redirectContext`, `redirectOriginFor`, `parseRedirectParts`, `parseRedirectOrigin` and `REDIRECT_ORIGIN_RE`; verify `grep -n "browserOrigin\|publicOrigins\|redirectOriginFor\|mcp-manager/callback" lib/index.js` returns nothing and the full suite passes.
- [x] 5.10 Remove the `redirectCtx` parameter from `serverView`, `workspaceServerView`, `listWorkspaces` and their call sites; verify `grep -n "redirectCtx" lib/index.js` returns nothing and the view tests pass.
- [x] 5.11 Split `startAuth` into preparation and authorization-URL construction and move the `exchangeCode` flow to accept the validated session; verify the OAuth suites pass and the two functions have no shared mutable state.

## 6. Configuration and API

- [x] 6.1 Add `oauthCallback` to the state file with automatic defaults when absent, without a migration pass; verify a test loads a state file without the key and reads the defaults, and that saving a configuration persists it.
- [x] 6.2 Extend `GET /settings` with the sanitized `oauthCallback` and `callbackStatus` (mode, listeners, last error); verify the API test asserts the payload shape while a listener is active.
- [x] 6.3 Add `PUT /settings/callback` that validates through the shared parser, persists under the state lock and returns the new configuration; verify tests cover a valid save, each rejection and that a rejected save leaves the stored value unchanged.
- [x] 6.4 Record the last callback listener failure in memory and clear it on the next successful acquire; verify the API test sees the error after a failed acquire and after a successful one.

## 7. View contract and interface

- [x] 7.1 Rework the server views to report `redirectMode`, `redirectUri` (only when knowable), `redirectDefaultUri`, `redirectLastUsedUri`, `redirectPending` and `redirectWarning`; verify a host test asserts the automatic, fixed and override cases.
- [x] 7.2 Add the **Advanced** callback section (collapsed by default) with an always-visible header showing mode, listener count and an error indicator, plus the expanded mode/hostname/port/path controls, listener list and last error; verify the client stub test asserts the collapsed status line, the error badge and the expanded fields.
- [x] 7.3 Turn the server form's redirect field into a complete-URI input that keeps the clear-to-default action and uses the host-provided placeholder; verify the client test asserts the placeholder in fixed mode, the automatic-mode wording and the rejected-value message.
- [x] 7.4 Render the automatic-mode card content: the "port assigned at authentication" state, the last used URI with the copy action, and the manual Client ID warning; verify a client test covers all three.
- [x] 7.5 Add every new string to both `zh` and `en` with identical key sets; verify the locale parity test and that switching language renders the section, status line and diagnostics without an untranslated key.

## 8. Test-suite migration

- [x] 8.1 Replace `test/redirect-url.test.js` with the four new suites and port the cases that still describe behavior (workspace override preservation, manual Client ID never re-registered, save keeps tokens); verify `node --test test/oauth-redirect-resolution.test.js test/oauth-callback-manager.test.js test/oauth-session-store.test.js test/oauth-callback-flow.test.js` passes.
- [x] 8.2 Update `test/oauth-discovery.test.js` to assert the redirect URI's shape with a fixed configuration instead of a literal port, keeping its discovery, re-registration and application-type coverage; verify the file passes.
- [x] 8.3 Update the client test for the new section and fields and confirm the remaining suites still pass; verify `node --test test/client-language.test.js` passes.
- [x] 8.4 Add the provider-behavior cases to the end-to-end stub (`error=access_denied` on the callback and a rejected redirect URI on the authorization request) and assert the operator-facing messages; verify the flow suite covers both.
- [x] 8.5 Add `test/helpers/oauth-harness.js` with the stubbed `ctx` and the authorization-server stub used by the new suites, without changing the existing inline harnesses; verify the new suites import it and `npm test` is green.

## 9. Documentation and release

- [x] 9.1 Update `AGENTS.md`: the source layout now includes `lib/oauth/`, and the architecture rules describe the callback listener, `state` routing, redirect resolution and the removal of `publicOrigins`; verify the file has no remaining claim that the redirect origin is derived from the request.
- [x] 9.2 Update `README.md` and `README.zh-CN.md` in sync: the callback URL shape, the global callback settings, the per-server redirect URI, the removal of `publicOrigins`, and the upgrade behavior for a non-loopback stored value; verify both documents describe the same behavior.
- [x] 9.3 Add `docs/release-v0.18.0.md` with the changes, the breaking notes and the verification record; verify it names the upgrade actions for existing installations.
- [x] 9.4 Bump `package.json` to 0.18.0 and commit with the docs; verify `node -p "require('./package.json').version"` prints `0.18.0`.
- [ ] 9.5 Create and push the annotated `v0.18.0` tag on the release commit; verify `git tag -v v0.18.0` shows an annotated tag and the tag points at the commit carrying the release.

## 10. Verification

- [x] 10.1 Run `npm test` and confirm every suite passes with no skipped or cancelled test; record the Node version and the pass count.
- [x] 10.2 Run `openspec validate centralize-oauth-callback --strict` and confirm the change validates.
- [ ] 10.3 Verify a real authorization round trip against an installed profile in a disposable `HOME`/`USERPROFILE`/`DSH_HOME` (`dsh plugin --profile web add <path>`, restart, authorize an HTTP OAuth server) and record the observed redirect URI and the fact that the listener released its port afterwards.
- [ ] 10.4 Verify a workspace-declared OAuth server authorizes through the same listener as a global server in that disposable profile, with no server id in the callback URL.
