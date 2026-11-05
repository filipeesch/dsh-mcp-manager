# Proposal

## Why

The Settings → MCP page reports whether a server is connected and how many tools it registered, but never which tools those are: an operator has to open the attempt log or ask an agent to discover what a server actually exposes. `GET /servers` and `GET /workspaces` are polled every three seconds, so folding every tool name into those payloads would inflate a hot path that must stay cheap.

Two smaller gaps share the same screen. The add button sits in the page header instead of next to the server search it belongs to. And on-demand tool injection — the broker that keeps the model-facing surface fixed instead of sending every `mcp__*` schema on every Native-mode request — is disabled by default, even though it is the safer starting point for a profile with many servers.

## What Changes

- **Raw tool names on the server card.** An expanded server card lists every registered tool by its raw `tools/list` name; the `mcp__<server>__<raw>` prefix stays implicit and the public normalized name is never shown. The list lives in a bounded scroll area, so a server with hundreds of tools does not change the card's layout, and long names wrap instead of overflowing.
- **One card for both tiers.** The workspace row adopts the global card's expandable arrangement (collapsed by default, chevron, status chip as the authentication action, actions and panels in the expanded body). The current workspace row is always expanded, which already diverges from the v0.18 card requirement.
- **A dedicated read endpoint.** `GET /mcp-manager/api/servers/:id/tools` returns the raw registered names, sorted. It is addressed by the same deterministic id that already serves `/logs`, so it resolves a global server, a loaded workspace server, and a workspace row projected from disk. `GET /servers` and `GET /workspaces` keep returning only the count.
- **Explicit empty states.** `needs-auth`, `error`, `disabled`, `connecting`, `configured`, `conflict`, and "connected but exposes no tools" each render their own message. A server that is not connected never shows a fabricated or stale list.
- **Add button beside the search.** The ＋ leaves the page header and joins a toolbar: next to the server search in the global view, and next to the workspace selector in the workspace view, styled as the theme's blue primary action.
- **On-demand tools on by default.** A profile whose state has no `onDemandToolInjection` value gets the broker enabled; an explicitly stored `false` stays off. Code/PTC presentations keep the full MCP catalog, as they do today: the broker cannot replace the program-callable surface there.
- **Refactor carried by the change.** One shared card component replaces the duplicated global/workspace row bodies, a single host helper projects raw names, dead client CSS is removed, the client test harness moves to `test/helpers/`, and the stale `connected (N tools)` documentation is corrected.
- Ships as release 0.19.0 with both READMEs, `AGENTS.md`, and a release note in sync.

## Capabilities

### New Capabilities

- `mcp-tool-inventory`: the host-side inventory of raw tool names exposed to the settings page — the id-addressed read endpoint, per-connection (global versus workspace) semantics, ordering, and the rule that the polled list endpoints stay count-only.
- `mcp-on-demand-tools`: when the on-demand broker is active, including the absent-setting default, and the boundary that Code/PTC presentations keep the full MCP catalog.

### Modified Capabilities

- `mcp-settings-ui`: the expanded server card gains the tool list and its empty states, both tiers share the same expandable card, the add action moves beside the search, and every new label is localized.

## Impact

- `lib/index.js`: the `/servers/:id/tools` route in the existing id block next to `/logs`, one projection helper over `conn.tools` / `wc.tools`, the absent-setting default in `apply()`, and no change to the `GET /servers` / `GET /workspaces` payloads.
- `lib/client.js`: `McpContent` owns the tool-list fetch (on expand and on every poll while expanded), a shared `ServerCard` replaces `ServerRow`/`WorkspaceServerRow`, a `ToolList` section renders the names and the per-status messages, the toolbar carries search/selector plus the blue add button, the on-demand initial state follows the host default, the `mcp` locale gains keys in `zh` and `en`, and dead CSS is removed.
- Tests: new host coverage for the endpoint across both tiers and a projected workspace row; the client suite covers the list, empty states, workspace selection, long lists, toolbar placement, the on-demand default, and both locales; host stubs that lack `guard`/`schemas` are updated for the new default, and the lock tests that toggled the setting to `true` start from an explicit `false`.
- Docs and state: `README.md`, `README.zh-CN.md`, `AGENTS.md`, `docs/release-v0.19.0.md`; `~/.dsh/mcp-manager.json` gains no new key — the default applies while `onDemandToolInjection` is absent.
- No new dependencies, no new host source files, no change to tool naming or registration, transports, OAuth, or the workspace config format.
