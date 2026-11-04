# Proposal

## Why

When an MCP server needs OAuth, the plugin decides the redirect URI itself: it derives it from the `Host` header of the request that starts authorization and appends `/mcp-manager/callback/<server-id>`. Opening the GUI at `127.0.0.1` therefore always produces `http://127.0.0.1:<port>/...`, and an authorization server that only accepts `localhost` (or another loopback alias) cannot be used at all. The operator has no way to correct it.

Two defects sit next to each other and block the same flow. First, the token exchange re-derives the origin from the *callback* request instead of reusing the value the authorization used, so a callback that arrives through a different host (a reverse proxy, a forwarded header the operator did not allow) fails with `invalid_grant`, and a custom redirect could never work. Second, the MCP server card's action row has no wrapping and the cards sit two per row, so with the authenticate, edit and delete buttons all present they overflow the card.

## What Changes

- Add an optional, non-secret per-server **redirect URL** to both server tiers: `redirectUrl` in the global state file and in a workspace `mcpServers[name]` entry. It accepts `host`, `host:port` or `scheme://host[:port]`; the callback path stays the plugin's own.
- Resolve the effective redirect URI in one place. Without an override it keeps today's default: loopback IP when the GUI is reached locally, the configured `publicOrigins` origin when there is one. An override that omits the port inherits the current GUI port, so `localhost` keeps working across restarts that pick a different port.
- Pin the redirect URI per authorization attempt: dynamic client registration, the authorization request and the token exchange all use the value fixed when the flow started, never a re-derived origin.
- Validate an override as a loopback host or as an origin listed in `config.publicOrigins`; `https` on a loopback host is accepted only through `publicOrigins`, because the plugin's own callback receiver is plain HTTP.
- Save an override without dropping tokens. The stored registration (and its tokens) belong to the previous redirect until the next Authenticate, which re-registers the dynamic client for the new exact redirect. The UI states that clearly instead of logging the user out on save.
- UI: a **Redirect URL** field in the OAuth section of the server form, the effective redirect URI with a copy action on the expanded card, and an overflow-proof action area — enable switch, authenticate button and a `⋯` menu holding Edit and Delete — on both the global and the workspace card.
- Ship as a user-visible release: version 0.17.0, both READMEs in sync.

## Capabilities

### New Capabilities
- `oauth-redirect-url`: how the plugin determines, validates, stores and applies the OAuth redirect URI for a server — the derived default, the per-server override, the pinned value per attempt, and the registration lifecycle around it.
- `mcp-settings-ui`: the presentation contract of the Settings → MCP page that this change touches — the server card action area, the effective redirect URI with its copy action, and the pending-registration cue.

### Modified Capabilities

None: the project has no specs yet, so both capabilities are introduced here.

## Impact

- `lib/index.js` (host half): the new field in `parseOauthFields`/`applyOauthFields`, a single `redirectUriFor` used by registration, authorization and exchange, the redirect URI recorded in `pending`, the callback route no longer deriving an origin, `sameServerConfig`, `serverView`, `workspaceServerView`, `buildWorkspaceEntry`, `normalizeWorkspaceServer`, `EXTERNAL_AUTH_FIELDS`, and the global `PUT` handler.
- `lib/client.js`: the redirect field (with clear-to-default), the `⋯` menu component and its CSS, the effective URL and copy action, the pending-registration cue, and new `mcp` locale keys in `zh` and `en`.
- State on disk: `~/.dsh/mcp-manager.json` gains a `redirectUrl` per server; `<workspace>/.dsh/dshmm/mcp.json` entries gain the same key. No migration is needed — an absent key means "use the derived default".
- Tests: a new host-half suite for resolution, validation, pinning and the registration lifecycle, workspace entries included, plus a client stub test for the menu and the field. Existing OAuth, discovery, workspace and client suites must keep passing.
- Docs: `README.md` and `README.zh-CN.md`; `package.json` version 0.17.0.
- No new dependencies, no change to tool naming, transports, workspace scoping or the on-demand broker.
