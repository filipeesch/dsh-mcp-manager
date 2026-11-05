# v0.19.0: tool names on the server card

Related board task: *Exibir nomes das tools de cada MCP no card* (Open Spec v1).
OpenSpec change: `expose-mcp-tool-names`.

The Settings → MCP page reported a server's connection state and a tool count,
but never which tools it exposed. Finding out meant opening the attempt log or
asking an agent. The polled list endpoints (`GET /servers`, `GET /workspaces`)
run every three seconds, so folding every tool name into them would have made a
hot path grow with each catalog.

## Changes

- New read endpoint `GET /mcp-manager/api/servers/:id/tools`:
  - `200 { "tools": ["alpha", "zulu"] }` — the live connection's raw
    `tools/list` names, sorted, without the `mcp__<server>__` prefix.
  - `409 { "error": "server is not connected" }` for `needs-auth`, `error`,
    `disabled`, `connecting`, `conflict`, and for a workspace row projected from
    disk.
  - `404 { "error": "server not found" }` for an unknown id.
  - It reuses the id routing that already serves `/logs`, so a global server, a
    loaded workspace server and a projected workspace row are all addressable
    with the id the page already holds. Global names come from the registration
    map; workspace names come from that connection's `tools/list` result.
  - `GET /servers` and `GET /workspaces` keep returning only `toolCount`; their
    payload does not grow with the number of tools.
- **Server card**: the expanded body now lists the raw tool names under a count
  heading, inside a bounded scroll area (~200 px). Long names wrap and a long
  list does not change the card's height. The list is fetched when the card
  expands and again after each poll while it stays expanded, so connect,
  reconnect, an edit or a `tools/list` change appears without a page reload.
- **Distinct empty states**: `needs-auth`, `error`, `disabled`, `connecting`,
  `configured` (declared but not loaded), `conflict`, connected-with-no-tools
  and a failed read each show their own message; a non-connected server never
  renders a list.
- **One card for both tiers**: the workspace row now uses the same expandable
  card as a global server (collapsed by default, chevron, status chip as the
  authentication action, actions and log panel in the expanded body). Its switch
  still calls `/workspaces/server-state`, and its auth/delete still use the
  workspace endpoints.
- **Add action moved**: the ＋ left the page header and now sits in a toolbar
  beside the server search (global view) or the workspace selector (workspace
  view), styled with the theme's primary blue action color. The header keeps the
  title and the count, and the empty-workspace hint points at the new location.
- **On-demand broker on by default**: a profile whose state has no
  `onDemandToolInjection` value starts with the broker enabled; an explicitly
  stored `false` keeps it off. Code/PTC presentations continue to keep the full
  MCP catalog (`docs/on-demand-code-mode.md`), because the broker cannot replace
  the program-callable surface there.
- **Refactors carried by the change**: one shared card view replaces the
  duplicated global/workspace row bodies; a single host helper projects raw tool
  names; the client test harness moved to `test/helpers/client-harness.js`; dead
  CSS (`mm_url`, `mm_wsServers`, `mm_wsExclude`, `mm_wsExcludeTitle`,
  `mm_wsCheck`, `mm_addActions`) was removed; the README's stale
  `connected (N tools)` description was corrected to the actual `Enabled` badge.

## API

```
GET /mcp-manager/api/servers/:id/tools

200 { "tools": ["alpha", "middle", "zebra"] }
409 { "error": "server is not connected" }
404 { "error": "server not found" }
```

`GET /mcp-manager/api/ping` now reports contract `version: 5`.

## Upgrade notes

- A profile that never used the on-demand switch now starts with the broker
  enabled: three broker tools are registered and direct `mcp__*` definitions are
  marked deferred on harnesses that support the marker. Turn the switch off in
  Settings → MCP to restore the previous direct surface; the explicit value is
  persisted.
- No state migration. `~/.dsh/mcp-manager.json` does not gain a key; the default
  is resolved at read time.
- The card, the endpoint and the client are additive, so a downgrade only loses
  the new UI and API route.

## Verification

Automated:

```sh
npm test
node --test test/tool-inventory.test.js test/client-tools.test.js
node --test test/on-demand-deferral.test.js test/oauth-resource.test.js
```

- `test/tool-inventory.test.js`: global/workspace names, ordering, raw-name
  shape, empty inventory, reconnect refresh, projected row, disabled,
  needs-auth, error, connecting, conflict, a workspace-local disabled row,
  unknown id, and both count-only polled views (including size stability).
- `test/client-tools.test.js`: fetch on expand and on the poll, every empty
  state, long list, workspace selection, both languages, the toolbar, a failed
  background refresh keeping a loaded list, a first-read failure recovering on
  the next poll, and the cached inventory being dropped on collapse or when the
  connection leaves `connected`.
- `test/on-demand-deferral.test.js`: the absent-setting default, the explicit
  `false`, and toggling live registrations without a reconnect.
- `test/oauth-resource.test.js`: the state-file lock tests now toggle away from
  the effective default, because a no-op toggle never acquires the lock.

Disposable-profile run (scratch `HOME`/`USERPROFILE`/`DSH_HOME`, DSH installed
from npm, no real profile touched):

- installed the plugin with `dsh plugin --profile web add <checkout>` and booted
  `dsh web --no-open`;
- `GET /mcp-manager/api/ping` → `{"ok":true,"version":5,...}`;
- `GET /settings` → `onDemandToolInjection: true` on a state without the field;
- added a loopback MCP fixture, connected it, and
  `GET /servers/:id/tools` → `{"tools":["alpha","middle","zebra"]}`;
- `GET /servers` returned `toolCount: 3` and no names;
- disabling the server made the same endpoint answer `409`.

The rendered card (scroll, wrapping, empty-state copy, toolbar) is covered by
`test/client-tools.test.js` and `test/client-language.test.js` rather than a
browser session; a visual pass in the running web UI remains for the operator.
