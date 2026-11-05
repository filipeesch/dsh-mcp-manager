# Tasks

## 1. Host: tool inventory endpoint

- [x] 1.1 Add one host helper that projects raw names from a live connection (global `conn.tools` keys, workspace `wc.tools` names; sorted, empty when connected with none) and serve `GET /mcp-manager/api/servers/:id/tools` from the existing id block in both the global and the workspace/projected branches, answering `200 { tools }`, `409 { error }` when not connected and `404` for an unknown id; bump the `ping` contract version from 4 to 5. Verify with a new `test/tool-inventory.test.js` that covers a connected global server, a workspace connection, a projected workspace row, `disabled`, `needs-auth`, `error`, `connecting` and an unknown id.
- [x] 1.2 Cover the inventory contract in the same suite: raw names (no `mcp__` prefix), ascending order independent of the server's order, no duplicate names, `[]` for a connected server that lists no tools, and the new names after a reconnect. Verify with `node --test test/tool-inventory.test.js`.
- [x] 1.3 Assert that `GET /servers` and `GET /workspaces` stay count-only: no `tools` array in either payload, and the response size does not grow when a fixture server registers many tools. Verify in the same suite.

## 2. On-demand default

- [x] 2.1 Resolve an absent `onDemandToolInjection` to enabled in `apply()` (only an explicit `false` disables the broker) and start the client's settings state at enabled. Verify with a host test that boots a state without the field (broker tools registered, `GET /settings` reports enabled) and a state with `false` (no broker tools, reports disabled).
- [x] 2.2 Audit the stubbed `apply()` contexts for the broker's dependencies (`guard`, `schemas`, `on`, `execute`) and add the missing members (`test/sse-basic.test.js`, `test/tool-timeout.test.js` at minimum); change tests that toggled the setting from the old default so they start from an explicit value. Verify the full suite still passes.
- [x] 2.3 Add a regression test that an explicit `false` keeps direct MCP tools callable and that toggling on/off applies to live registrations without a reconnect. Verify with `node --test test/on-demand-deferral.test.js`.

## 3. Client: shared card and tool inventory

- [x] 3.1 Extract the `node:vm` + React-stub harness from `test/client-language.test.js` into `test/helpers/client-harness.js` and make the existing suite import it. Verify `node --test test/client-language.test.js` passes with unchanged assertions.
- [x] 3.2 Add container-side inventory state to `McpContent`: fetch the endpoint when a card expands and after each poll while it stays expanded, skip the request when the status is not `connected`, and ignore a response that arrives after collapse or disconnect; pass the result to both card components. Verify with a client test that expands a connected card, observes the request and the rendered names.
- [x] 3.3 Build the `ToolList` section: heading with the count, monospace raw names sorted ascending, a bounded scroll area with wrapping, and the distinct messages for `needs-auth`, `error`, `disabled`, `connecting`, `configured`, `conflict`, connected-but-empty and a failed read. Verify each state in the client suite.
- [x] 3.4 Extract `ServerCard` and reduce `ServerRow` and `WorkspaceServerRow` to thin adapters, making a workspace row start collapsed while keeping its own switch (`/workspaces/server-state`), auth and delete requests. Verify the existing per-tier tests still pass and add expansion coverage.
- [x] 3.5 Move the add action into a toolbar beside the search input (global view) and the workspace selector (workspace view), use the theme's primary color and an accessible name, remove it from the page header, and update the empty-workspace hint. Verify placement, header absence and the accessible name in the client suite.
- [x] 3.6 Add every new string to both `zh` and `en` (tool heading and count, each state message, read failure, add label, empty-workspace hint) and verify the dictionary key-set equality test plus rendering in both locales.
- [x] 3.7 Delete the dead CSS (`mm_url`, `mm_wsServers`, `mm_wsExclude`, `mm_wsExcludeTitle`, `mm_wsCheck`) and the orphaned `mm_addActions` wrapper. Verify no `mm_*` class in the stylesheet is absent from the component code.

## 4. Docs and release

- [x] 4.1 Update `README.md` and `README.zh-CN.md`: the tool list and its states, the toolbar add action, the on-demand default, the new endpoint, and the corrected status-badge description (`Enabled`, not `connected (N tools)`). Verify both editions describe the same behavior.
- [x] 4.2 Update `AGENTS.md` (card and inventory rules, on-demand default, endpoint, client test harness path) and add `docs/release-v0.19.0.md`. Verify the layout section matches the files on disk.
- [x] 4.3 Bump `package.json` to 0.19.0 and verify the release note names the same version; record that the annotated `v0.19.0` tag is created on the merged `main` commit as part of the release step.

## 5. Verification

- [x] 5.1 Run `npm test` and confirm the full suite passes.
- [ ] 5.2 Install into a scratch DSH web profile (`HOME`, `USERPROFILE` and `DSH_HOME` pointed at a temporary directory), open Settings → MCP and confirm: a connected card lists raw names and scrolls, each empty state differs, a workspace card expands, the toolbar add action opens the form, the on-demand switch starts on for a state without the field, and a card refreshes after a reconnect without a page reload. Never point this at the real profile.
