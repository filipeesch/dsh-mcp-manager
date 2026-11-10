# Proposal

## Why

A server that cannot authenticate at connect time disappears from the model's world. When the connection fails, the host unregisters every tool of that server, so the model never sees them, never calls one, and never reaches the conversation authentication flow — which today only exists for a call that is already registered. The operator has to notice the failure in Settings → MCP on their own, and a model asked to use that server has no way to ask for authorization at all. The plugin already owns every piece of the flow (OAuth start, tool listing, the connection registry); what is missing is exposing the catalog it already saw and giving the model an explicit way to request authorization.

Separately, the plugin ships two interface languages and two READMEs while being maintained in English only.

## What Changes

- Persist, per server, the raw `tools/list` catalog in a sidecar file `~/.dsh/mcp-manager-tools.json` that carries no secrets: refreshed on every successful listing, and discarded when the server is removed.
- While a server is `needs-auth` and a cached catalog exists, register those entries as cached definitions so the model sees the server's tools again. The description and parameters are the server's own, so the model cannot tell a cached definition from a live one until it calls.
- A call to a cached definition SHALL fail immediately with an actionable error that names the server and tells the model to call `mcp_authenticate_server("<server>")`. It SHALL NOT wait.
- Add the `mcp_authenticate_server` tool: registered while any server uses browser authorization, accepted for a global or a workspace server, starting the existing OAuth flow, opening the system browser (skipped over SSH), returning the authorization URL immediately, and never starting a second flow for a server that already has one pending.
- Announce a completed authorization to the model once the server reconnects, through dynamic model context (a user-role snapshot, not system-prompt text), and emit it a single time.
- Serve cached names from `GET /servers/:id/tools` for a `needs-auth` server (200 with a stale marker) and render them on the server card with a stale badge.
- Move the plugin's tool registration out of `lib/index.js` into `lib/tools/*` modules so cached definitions, live synchronization, and the authentication tool share one seam instead of growing the host file.
- **BREAKING**: the client becomes English-only. The Chinese dictionary is removed, the bilingual requirements are dropped, and `README.zh-CN.md` leaves the package.

## Capabilities

### New Capabilities

- `mcp-unauthenticated-tools`: the cached catalog, its exposure to the model while a server needs authentication, and the fail-fast call error.
- `mcp-auth-request`: the `mcp_authenticate_server` tool, the browser launch it triggers, and the announcement after a completed authorization.
- `plugin-language`: the plugin's interface and shipped documentation are English-only.

### Modified Capabilities

- `mcp-auth-recovery`: a call to a server with no live connection fails immediately with an actionable error instead of waiting for a reauthorization.
- `mcp-tool-inventory`: a `needs-auth` server reports its cached names with a stale marker instead of answering `409`.
- `mcp-settings-ui`: the card renders cached names with a stale badge; the bilingual label requirements are removed.
- `mcp-chat-auth`: the localized-copy requirement is removed.

## Impact

- **Code**: `lib/index.js` (registration extraction, cached definitions, authentication tool wiring, sidecar load and save), new `lib/tools/*` modules, `lib/browser/open-url.js`, and `lib/client.js` (English-only strings, cached tool list, stale badge).
- **State**: a new non-sensitive file `~/.dsh/mcp-manager-tools.json`; safe to delete, rebuilt on the next successful listing.
- **External surfaces**: `GET /servers/:id/tools` gains a `200` case for `needs-auth`; two new model-facing tools (`mcp_authenticate_server` only, plus the cached definitions).
- **Unchanged**: the OAuth callback listeners, redirect resolution, JSON import, the on-demand broker contract, and the authentication banner behavior.
- **Docs and tests**: `test/*.test.js`, `README.md`, `AGENTS.md`, `docs/release-v0.22.0.md`, version 0.22.0; `README.zh-CN.md` removed from the repository and from the published file list.
