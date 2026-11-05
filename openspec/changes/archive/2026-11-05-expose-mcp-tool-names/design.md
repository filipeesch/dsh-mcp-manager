# Design

## Context

See `proposal.md` — Why. The state this design builds on:

- The host already holds the raw tool names. A connected global server keeps `conn.tools` as a `Map<rawName, registration>` plus `conn.toolCount`; a workspace connection keeps `wc.tools` as the raw `tools/list` array plus `wc.toolCount`. Only `toolCount` reaches the page.
- `GET /servers` and `GET /workspaces` are polled by the settings page every three seconds. They are the hot path and stay count-only.
- The id-addressed route block (`/servers/:id/*`) already serves `/logs` for a global server, a loaded workspace server, and a workspace row projected from disk (its id is deterministic: `ws-<sha256(workspace+name)[0:20]>`). A new action on that route inherits the same resolution for free.
- The client is one hand-written module factory (`lib/client.js`) with no bundler and no JSX. `McpContent` owns the 3 s poll; `ServerRow` (global) is expandable and shows errors, actions and the log panel; `WorkspaceServerRow` is always expanded and shows actions; `GlobalMaskRow` is a per-workspace switch for a global server.
- The client test harness runs the real factory inside `node:vm` with a minimal React stub (`useState`, `useEffect`, `useCallback`) and renders component functions directly. It runs `useEffect` callbacks once, at mount, and cannot re-run them per render.
- On-demand tool injection is a single profile setting. Today `apply()` normalizes a missing value to `false`; the broker runtime registers three tools, marks direct `mcp__*` definitions deferred, and installs a guard plus a system-prompt waterfall. Code/PTC presentations deliberately keep the full catalog (`docs/on-demand-code-mode.md`).
- Project constraints: two client/host source files plus `lib/oauth/*`; zero dependencies; every user-visible string in `zh` and `en`; release 0.19.0 with an annotated tag.

## Goals / Non-Goals

**Goals:**

- Expose the raw tool names of a live connection to the card without touching the polled list endpoints.
- Make the tool section's data flow single-owner and testable with the existing fake-React harness.
- Give the workspace row the global card's expandable arrangement through one shared component instead of two copies.
- Keep the on-demand change to the default only: no new broker behavior, no change to how tools are registered.

**Non-Goals:**

- Tool descriptions, input schemas, categories, search or filtering inside the card.
- Virtualizing or paginating the tool list; a bounded scroll area is enough.
- A per-server toggle for on-demand injection or a UI to choose the broker's behavior per presentation.
- Changing `docs/on-demand-code-mode.md`'s conclusion: SDK catalog compression is not implemented.
- Extracting new host source files; the host helpers stay in `lib/index.js`.
- Showing tools on `GlobalMaskRow`; it is a per-workspace switch, not a connection.

## Decisions

### D1 — A dedicated id-addressed endpoint, not names in the polled views

`GET /mcp-manager/api/servers/:id/tools` returns `{ tools }` for a live connection and `409` otherwise; an unknown id is `404`. It is implemented in the existing id block next to `/logs`, so a global server, a loaded workspace server and a projected workspace row are all addressable by the id the page already has. The name projection lives in one host helper that reads the live connection (`conn.tools` keys for global, `wc.tools` names for workspace), sorts, and never caches.

*Why*: the polled views are the hot path and must not grow with tool counts; the page only needs names while a card is expanded; `/logs` proves the id resolution and the 409/404 vocabulary. *Alternatives rejected*: names inside `/servers`/`/workspaces` (payload inflation on every poll, and the acceptance criteria explicitly ask to keep them cheap); an `?includeTools=1` switch on those endpoints (still couples tool traffic to the list poll and would either fetch names for every server or need a second code path anyway); a `toolsRevision` field in the views (a second truth about the inventory for no user-visible benefit — see D5).

### D2 — The container owns the fetch; cards are presentational

`McpContent` keeps `toolLists` (`{ [id]: { phase: 'loading' | 'ready' | 'error', names, error } }`) and owns every call to the tools endpoint: once when a card expands and once after each successful poll while that card stays expanded. The cards receive `server` and `tools` as props and never fetch.

*Why*: one owner for polling and network state avoids duplicating fetch logic in both row components, lets a stale response be ignored by id, and keeps the card renderable with plain props — which is what the existing fake-React harness can test. *Alternatives rejected*: a `useEffect` inside each card (the harness cannot re-run effects per render, and a card would fetch independently of the poll); folding names into the polled views (D1).

### D3 — One shared card for both tiers

`ServerCard` owns the header (name, chevron, status dot, status chip), the collapsed error summary, the expanded body (scope/error lines → tool section → action row → log panel) and the delete dialog. `ServerRow` (global) and `WorkspaceServerRow` (workspace) become thin adapters that supply: the enable semantics (global `enabled` versus workspace `disabled`), the toggle request, the authentication request, the edit callback and the delete dialog labels. The workspace row starts collapsed, like the global card.

*Why*: the workspace row must adopt the exact global arrangement, and the tool section must not be written twice. The two components already duplicate the header, chip, actions, dialog and log panel (~80 lines). *Alternatives rejected*: a "Tools" toggle in the existing always-visible workspace action row (inconsistent with the global card and the v0.18 requirement); duplicating the tool section in both components (two places to keep in sync).

The adapters keep the observable per-tier behavior: the workspace switch still posts to `/workspaces/server-state`, the global switch to `/servers/:id/enabled`; the scope-insufficiency lookup (`oauth.insufficientScope` for global, top-level for workspace) moves into one helper so both cards render the same message.

### D4 — Tool section: sorted raw names, bounded scroll, explicit states

The section renders a heading with the count, then one monospace line per name, sorted ascending, inside a `max-height` (~200 px) `overflow-y: auto` area with `word-break` wrapping. There is no cap and no "show all" toggle: every name is reachable by scrolling, and the card height is bounded. The heading count comes from the fetched names while they are ready and falls back to `toolCount` while loading, so heading and list never disagree for a poll tick.

Empty states are keyed by the server's status: `needs-auth`, `error`, `disabled`, `connecting`, `configured`, `conflict`, plus "connected but no tools". A non-connected card renders its state message and no list; a failed fetch renders a localized read-failure message, never an empty list. `GlobalMaskRow` shows no tool section.

*Why*: raw names are the contract; scroll is the smallest solution that satisfies "a long list must not change the layout"; status already exists in the polled views, so empty states need no new host signal. *Alternatives rejected*: truncation plus "show all" (extra per-card state); a scroll area with an item cap (two mechanisms where one suffices); descriptions or schemas (out of scope).

### D5 — Refresh on expand and on every poll while expanded

The container fetches when the card expands and after each poll while it remains expanded. It skips the request while the status is not `connected` and discards a response that arrives after the card collapsed or the server left `connected`.

*Why*: connect, reconnect, edit and `tools/list` changes are all followed within one poll cycle; the policy is correct even when a tool is renamed without changing the count. One small GET per three seconds per open card is negligible next to the existing three list requests. *Alternatives rejected*: fetching only on expand (a stale list after a reconnect while open); a `toolsRevision` in the views (host state, tests and payload for an optimization no user asked for). The option remains open if the request volume ever matters.

### D6 — Add action in a toolbar, primary color

The page header keeps the title and the server count. A toolbar row holds the search input (global view) or the workspace selector (workspace view) with the add action at its end. The add action becomes a 36 px circular button using `--dsw-alias-state-business-primary` with a `--dsw-alias-label-primary-foreground` icon, replacing the neutral 28 px header button and its `mm_addActions` wrapper. The empty-workspace hint is reworded to point at the toolbar.

*Why*: one predictable location in both views, matching the request and the theme's primary action vocabulary already used by `.mm_btn.primary` and the switches. *Alternatives rejected*: moving it only in the global view (two different locations); recolor-only in the header (does not satisfy "next to the search").

### D7 — On-demand default resolves an absent value to enabled

`apply()` changes its normalization from "anything other than `true` is `false`" to "anything other than `false` is `true`". An explicitly persisted `false` keeps the broker off; no new key is written until the operator toggles. The client's initial `settings` state starts at `onDemandToolInjection: true` so the switch does not flash "off" before `/settings` resolves.

*Why*: this is the request's default change with the smallest state surface, and it preserves an explicit choice. *Alternatives rejected*: default only for fresh installs (requires detecting a first run, and the user chose the broader default); a migration that writes `true` into every state file (mutates profiles that never expressed a preference and complicates the lock/merge path).

*Consequence*: `installBrokerRuntime()` now runs at boot for any state without the field. Test stubs that mount the plugin must provide `guard`, `schemas`, `on` and `execute` (already true for most; `test/sse-basic.test.js` and `test/tool-timeout.test.js` need `guard`), and tests that assert the toggle by posting `enabled: true` must start from a state that stores `false` (or toggle in the other direction). Existing tests keep their behavior by writing the field explicitly where they depend on the broker being off.

### D8 — Code/PTC boundary stays as documented

The presentation detection and the full-catalog fallback are untouched. Only the default flips, so an agent that assembles as Code/PTC continues to see every `mcp__*` tool and its direct calls stay admitted; native agents get the deferred marker. The current per-agent warning stays (it is accurate), and the docs state the limitation.

*Why*: on DSH 0.2.2 the broker cannot be called from inside `run_code`, so hiding direct tools in that presentation would remove the only usable path. *Alternatives rejected*: deferring direct tools in Code/PTC (breaks the programs); a version-pinned SDK adapter (a separate capability with its own evidence; see `docs/on-demand-code-mode.md`).

### D9 — Refactor stays inside the existing file layout

The shared card and its subcomponents live in `lib/client.js`; the host name projection lives in `lib/index.js` near the view builders. The client test harness moves to `test/helpers/client-harness.js` so the new suite can reuse it, dead CSS (`mm_url`, `mm_wsServers`, `mm_wsExclude`, `mm_wsExcludeTitle`, `mm_wsCheck`) is deleted, and the stale `connected (N tools)` README claim is corrected.

*Why*: the project keeps its source layout unless a refactor is explicitly requested (AGENTS.md); the harness move is a test-only change and follows the existing `test/helpers/oauth-harness.js` precedent.

## Risks / Trade-offs

- **[Default-on surprises existing profiles]** → The upgrade note in the release doc and README states it; an explicit `false` keeps the previous behavior; the switch is one click and the broker tools are additive.
- **[Broker install breaks test stubs that never needed it]** → Audit every stubbed `apply()` context for `guard`/`schemas`/`on`/`execute` and add the missing members; tests that assert the setting start from an explicit value.
- **[A card shows "connected" while the tools request answers 409]** → Render the read-failure state, never an empty list; the next poll corrects the badge.
- **[One GET per three seconds per expanded card]** → Bounded by the number of expanded cards (the page keeps one expanded at a time); the endpoint returns names only. A revision-based optimization can be added later without changing the contract.
- **[Shared-card refactor regresses per-tier wiring]** → Keep thin per-tier adapters and rely on the existing tests that already exercise both tiers (switch endpoint, auth endpoint, delete confirmation); add tool-section coverage on top.
- **[The fake-React harness cannot re-run effects]** → Keep the fetch in the container's handlers and poll; render cards with props in tests.
- **[Sorted order differs from the server's own order]** → Deliberate: stable, comparable, and independent of the server; the spec requires ascending order.

## Migration Plan

No state migration. A profile with `onDemandToolInjection` absent becomes enabled on the next start; a profile that stored `false` is unchanged. The tools endpoint and the card are additive, so a downgrade only loses the new UI. Ship as 0.19.0: bump `package.json`, sync `README.md`/`README.zh-CN.md`/`AGENTS.md`, write `docs/release-v0.19.0.md`, commit on `main`, and create the annotated `v0.19.0` tag on that commit.

## Open Questions

None. Deferred by decision: descriptions/schemas in the card, list virtualization, and SDK catalog compression for Code/PTC.
