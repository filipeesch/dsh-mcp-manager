# Tasks

## 1. Extract the pure configuration helpers

- [x] 1.1 Create `lib/servers/config.js` and move `normalizeAuthMode`, `parseArgs`, `parseEnv`, `applyTimeout`, `normalizeTimeout`, `parseOauthFields`, `applyOauthFields` and `sameServerConfig` into it unchanged, importing them back in `lib/index.js`; verify with `npm test` (no behaviour change expected).
- [x] 1.2 Move `normalizeWorkspaceServer` and `buildWorkspaceEntry` into the module, add `buildServerEntry(input, current)` as the single normalizer, and route all four existing write paths through it; verify `node --test test/workspace-disable.test.js test/workspace-reconnect.test.js test/no-auth-mode.test.js test/oauth-dcr-client-name.test.js` passes.
- [x] 1.3 Attach `field` to every validation error raised by `parseOauthFields` and the entry builder, keeping `.message` unchanged for existing callers; verify a new assertion in `test/servers-config.test.js` checks `field` for `url`, `clientId`, `clientSecretEnv`, `clientName`, `scope`, `redirectUrl` and `timeout`.
- [x] 1.4 Add `sameAuthIdentity(a, b)` (endpoint origin, `clientId`, `clientSecretEnv`, `registrationNameKey`, `issuerOf`) and use it in both edit paths; verify a test asserts that an empty `tokenEnv` inherits in both tiers and that a changed endpoint origin drops the stored session in the workspace path too.

## 2. Document parser and planner (pure)

- [x] 2.1 Implement `parseDocument` in `lib/import/format.js`: accept an object or a JSON string, require the `mcpServers` envelope, reject a bare entry, an array, and names that collide after trimming; verify in `test/import-format.test.js`.
- [x] 2.2 Normalize each entry through `buildServerEntry` with import-only transport inference (missing `type` + `command` without `url` → stdio, `sse` → `http` with a note) and unknown-key discard; verify tests for a Claude-style stdio paste, an `sse` entry, an entry with neither `command` nor `url`, and a document carrying `oauth`/`tokens`/`staticToken`.
- [x] 2.3 Implement `planImport(entries, snapshot, options)` classifying `new`, `update`, `unchanged`, `conflict`, `invalid` and, in edit mode, `delete`; verify one test per class and a mixed five-entry batch.
- [x] 2.4 Compute the per-entry `changes` list (`field`, `from`, `to`), `keepsSession`, `staysDisabled`, `conflict` owner and `applyCount`; verify tests for a URL-only update, a transport change, a header removal, and a disabled entry.
- [x] 2.5 Implement per-entry conflict resolution (`keep` / `replace`) and the `blocked` reason (`invalid`, `conflict`); verify a plan with an undecided conflict is blocked, `keep` excludes the entry from `applyCount`, and `replace` marks it for a scope move.
- [x] 2.6 Pin the merge rules per tier in the planner: profile rows are patched (unknown row keys preserved), workspace entries are replaced whole (unknown entry keys dropped), omitted OAuth fields inherit, explicit empty strings clear; verify with a table-driven test over both tiers.

## 3. Application layer

- [x] 3.1 Create `lib/import/apply.js` with `applyPlan(plan, ports, options)` and a fake-ports test harness; verify a global create applies and `saveState` is called once.
- [x] 3.2 Apply profile updates by patching the stored row in place, preserving unknown row keys, and keep `server.oauth` only when `sameAuthIdentity` holds; verify tests for a kept session, a dropped session (changed `clientId`), and a preserved unknown row key.
- [x] 3.3 Apply workspace entries by rewriting only `mcpServers[name]` and preserving `exclude`, `disabled` and unknown top-level keys; verify a test reads the file back and asserts the untouched keys.
- [x] 3.4 Implement `replace`: remove the conflicting entry from its own scope, prune its off-list entries when no profile server owns the name, and move the stored session when the identity matches; verify a test for the workspace→profile move with and without a matching identity.
- [x] 3.5 Implement edit-mode deletions reusing the delete semantics (cancel sessions, drop the stored session, prune `disabled`/`exclude`); verify a test that deletes one entry and asserts the file, the token slot and the off lists.
- [x] 3.6 Order the writes: state before the workspace file, and report a workspace-write failure without rolling back the state; verify a test whose `writeWorkspaceRaw` throws and which asserts the error surfaces and the orphan slot is pruned on the next rescan.
- [x] 3.7 Apply the connection policy: connect a created server with credentials, reconnect a changed one, leave an unchanged one alone, never connect a disabled one, never touch `enabled`/`disabled`; verify against a loopback endpoint that counts connections.

## 4. HTTP contract and wiring

- [x] 4.1 Add `POST /mcp-manager/api/import` ahead of the id matcher, resolving the workspace through `knownWorkspacePath` and honoring `lockedName`; verify via the stubbed-context `mount()` helper: `200` for a plan, `400` for a malformed document, `403` for an unregistered workspace.
- [x] 4.2 Wire the real ports (`loadState`-backed snapshot, `readWorkspaceRaw`, `writeWorkspaceRaw`, `saveState`, `rescanWorkspace`, `connect`, `disconnect`, `cancelSessionsFor`); verify an API test that imports two servers and reads them back through `GET /servers` and `GET /workspaces`.
- [x] 4.3 Implement `dryRun`: a preview writes nothing and does not connect; an apply re-validates from the submitted document and returns the applied plan; verify a test that previews, changes the scope out of band, and asserts the applied plan reflects the new state.
- [x] 4.4 Enforce the batch limits (200 entries, 1 MiB) before validation and return the stated message; verify one test per limit, each asserting nothing was written.

## 5. Client

- [x] 5.1 Add the `⋯` overflow action after the add action in `.mm_toolbar` and in `.mm_wsBar` (workspace selected only), opening a menu with **Edit JSON** and **Import JSON** that dismisses without side effects; verify a client test for both layouts, the unselected case, and dismissal.
- [x] 5.2 Add the JSON dialog: document text area with an inline parse error, scope selector defaulting to the page's scope, preview panel beside it, `Cancel` and an `Apply` button carrying the entry count disabled while the plan is blocked; verify a client test for the default scope, the blocked state, and the apply count.
- [x] 5.3 Render the preview: one compact line per entry with its classification and changed field names, expanding to `from → to` values, with `invalid` and undecided `conflict` lines expanded and the `keep`/`replace` choice wired to the request; verify a client test covering all six labels and a conflict round trip.
- [x] 5.4 Add the **Edit as JSON** action to `serverCardView` in the visible action row beside Edit, opening the dialog locked to that server and scope; verify a client test for both tiers and a locked-name rejection.
- [x] 5.5 Add every new string to the `mcp` namespace in `zh` and `en` with the same key set; verify `test/client-language.test.js` parity and a render assertion in both languages.

## 6. Documentation and release

- [x] 6.1 Document the accepted document, the two modes and their asymmetry, the merge table, the conflict/replace and delete rules, and the unknown-key behaviour in `README.md` and `README.zh-CN.md`; verify both files describe the same fields and modes.
- [x] 6.2 Update `AGENTS.md` with the new layout (`lib/servers/config.js`, `lib/import/*`), the single builder and identity predicate, the import contract, and the no-hidden-state-changes rule; verify the section names the files and the invariants.
- [x] 6.3 Bump `package.json` to `0.20.0` and add `docs/release-v0.20.0.md`; verify the version, the note, and the `files` list include the new modules.
- [x] 6.4 Reconcile with `expose-mcp-tool-names` after it lands: move the `⋯` and the card action onto the merged `serverCardView`/toolbar and re-run the client suites; verify `node --test test/client-*.test.js` and the merge diff touch no 0.19.0 behaviour.
- [ ] 6.5 Run the full suite and verify in a live DSH web profile installed under a scratch `HOME`: `GET /mcp-manager/api/ping`, paste a multi-server document, preview, apply, and confirm the created servers connect and a second identical paste classifies every entry as unchanged.
