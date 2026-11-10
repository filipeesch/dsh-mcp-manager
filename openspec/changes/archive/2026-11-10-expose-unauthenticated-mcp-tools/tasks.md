# Tasks

## 1. Extract the registration block

- [x] 1.1 Move `makeToolDefinition`, `registrationSignature`, `disposeRegistrations`, the deferral retag helpers and `syncToolRegistrations` with the global and workspace sync wrappers out of `lib/index.js` into `lib/tools/registration.js`, exposed as a factory that receives its collaborators (registry access, logger, public-name mapping, parameter conversion, image projection, concurrency predicate, deferral decision). Verify `npm test` passes with no source change to the assertions.
- [x] 1.2 Keep the three existing call sites (`connect`, the agent-scope sync, the SSE-close path) wired through the factory and verify `node --test test/on-demand-deferral.test.js test/broker-presentation.test.js test/workspace-reconnect.test.js` passes unchanged.
- [x] 1.3 Confirm the extraction is behavior-preserving: `git diff --stat` shows `lib/index.js` only losing moved code and adding wiring, and no test file changes.

## 2. Persist the tool catalog

- [x] 2.1 Add `lib/tools/catalog.js`: normalize a raw `tools/list` entry to `{ name, description, inputSchema }`, enforce the per-server cap (200 entries, 128 KiB serialized), order by name, and reject entries without a usable name. Verify with a new `test/tool-catalog.test.js` covering normalization, the cap, ordering and malformed entries.
- [x] 2.2 Add `lib/tools/catalog-store.js`: read and write `~/.dsh/mcp-manager-tools.json` as `{ version: 1, servers: { "<serverKey>": { name, listedAt, tools } } }`, with atomic replace, a sidecar-owned lock, injected fs and clock, and a corrupt file read as empty with one warning. Verify with `test/tool-catalog-store.test.js` (round trip, corrupt file, concurrent read-modify-write of two keys, injected failure on write).
- [x] 2.3 Persist the catalog on every successful listing (connect and `notifications/tools/list_changed`) and delete the entry when the server is removed. Verify with a harness test asserting one write per successful listing, no write on a failed listing, and removal cleanup.
- [x] 2.4 Verify the sidecar never carries credential material: assert in `test/tool-catalog-store.test.js` that a catalog built from a listing with a token-looking description and an OAuth state file present produces a file with no `access_token`, `refresh_token`, `client_secret`, code or authorization URL.

## 3. Expose cached definitions and fail fast

- [x] 3.1 Change the definition's `execute` to resolve the server's live connection at attempt time: dispatch through the live handle when it exists, otherwise throw `AuthRequiredError`. Verify the existing call-path suites still pass and add a case proving a call after a reconnect uses the new handle.
- [x] 3.2 Register the retained catalog as cached definitions when the connection is `needs-auth`, at both tiers, and skip `disabled`, `error`, `connecting`, `configured`-but-not-loaded and `conflict`. Verify with harness tests per state.
- [x] 3.3 Add the fail-fast outcome to the model-facing auth error builder: name the server, state the call was not executed, instruct `mcp_authenticate_server("<server>")`, and keep the no-secret rule. Verify the text in `test/auth-blocking.test.js` and a no-attention-entry assertion against the gate.
- [x] 3.4 Verify a cached definition obeys the broker: with `onDemandToolInjection` enabled, `mcp_search_tools` returns the cached name, `mcp_describe_tool` describes it, and `mcp_execute_tool` fails with the actionable error. Cover in `test/on-demand-deferral.test.js`.

## 4. Report the cached inventory

- [x] 4.1 Serve `200 { tools, stale: true }` from `GET /servers/:id/tools` for a `needs-auth` server with a catalog, keep `409` for a `needs-auth` server without one and for every other disconnected state, and keep `404` for an unknown id. Verify with `test/tool-inventory.test.js`.
- [x] 4.2 Render cached names with a stale badge in the server card and keep the empty-state messages for the no-catalog case. Verify through `test/client-tools.test.js` and the shared client harness.
- [x] 4.3 Verify the badge disappears after a reconnect replaces the catalog, in the same client test.

## 5. Add the authorization tool

- [x] 5.1 Extract the authorization start from the `POST /servers/:id/auth` handler into one function used by both the route and the new tool, and verify the route's existing tests still pass.
- [x] 5.2 Register `mcp_authenticate_server` while the set of browser-authorizable servers (global plus any workspace) is non-empty and dispose it when the set empties. Verify registration and disposal in a new `test/auth-tool.test.js`.
- [x] 5.3 Resolve the addressed server in the caller's scope: global servers, the calling agent's workspace servers, and a clear failure for another workspace or an unknown name. Cover all four cases in `test/auth-tool.test.js`.
- [x] 5.4 Return the authorization URL immediately, reuse a pending session's URL instead of starting a second flow, and never change a server's configuration, tokens or enabled state. Verify with the pending-session case and a disabled-server case.
- [x] 5.5 Add `lib/browser/open-url.js` with an injected `spawn`: `open` on macOS, `cmd /c start` on Windows, `xdg-open` elsewhere; skip when `SSH_CONNECTION` or `SSH_TTY` is set; treat a launcher failure as non-fatal. Verify with `test/open-url.test.js` using a fake spawn.
- [x] 5.6 Verify the tool stays directly callable with the on-demand broker enabled and is never deferred, in `test/broker-presentation.test.js`.

## 6. Announce a completed authorization

- [x] 6.1 Add the read-once notice provider through `ctx.systemPrompt.context()`: return the text only while a notice is queued and clear it when read. Verify with a stub `systemPrompt` that the notice appears in exactly one assembly.
- [x] 6.2 Queue the notice only when the authorization completes and the server reconnects, and never when the token exchange fails. Verify both cases in `test/auth-tool.test.js`.
- [x] 6.3 Verify a host without `ctx.systemPrompt` drops the notice, logs once, and still completes the authorization.

## 7. Make the interface English-only

- [x] 7.1 Remove the Chinese dictionary and the language resolution from `lib/client.js`, collapse `t()` to the English string, and update `test/helpers/client-harness.js` plus the client suites. Verify `node --test test/client-language.test.js test/client-tools.test.js test/client-chat-auth.test.js test/client-json.test.js` passes.
- [x] 7.2 Search the repository for the removed dictionary keys and the language switch, and verify no reference remains.
- [x] 7.3 Delete `README.zh-CN.md`, drop it from `package.json`'s `files`, from the shipped README's links and from `AGENTS.md`, and verify `npm test` and a package `files` check pass.

## 8. Release and verify

- [x] 8.1 Bump `package.json` to 0.22.0 and add `docs/release-v0.22.0.md` covering the sidecar file, `mcp_authenticate_server`, the stale inventory and the language removal.
- [x] 8.2 Update `README.md` and `AGENTS.md` for the new file, the new module layout and the new tool.
- [x] 8.3 Run the full suite (`npm test`) and `openspec validate expose-unauthenticated-mcp-tools --type change --strict`.
- [ ] 8.4 Verify end to end on a disposable profile (scratch `HOME`, `USERPROFILE` and `DSH_HOME`): a server that needs authentication shows its cached tools to the model, a call fails with the instruction, `mcp_authenticate_server` opens the browser and returns the URL, the notice appears once after the reconnect, and the card shows the stale badge before it and the live names after it.
