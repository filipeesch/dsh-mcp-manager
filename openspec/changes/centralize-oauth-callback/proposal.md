# Proposal

## Why

The OAuth callback is not a callback infrastructure — it is a route on the DSH GUI webserver (`GET /mcp-manager/callback/<server-id>`), so it inherits the GUI's host, port and lifecycle. That couples OAuth to the web interface: a profile without a webserver can never receive a code, the redirect URI cannot be a port the operator pinned, and the URI must embed an MCP server id that changes when a server is re-added. Routing by server id also means one pending flow per server, so a second tab silently invalidates the first, and there is no expiry, no replay guard beyond a single map slot, and no listener to start or stop.

Authorization servers that pre-register redirect URIs make this a hard blocker: they require a fixed hostname, port or path, and the plugin cannot satisfy one without a listener it owns.

## What Changes

- **New centralized callback subsystem** (`lib/oauth/*`): dedicated HTTP listeners bound to loopback only, started when an authorization starts, shared by every MCP connection with a compatible address, and stopped when no pending flow needs them.
- Callback URL shape becomes `http://<loopback-host>:<port><path>` with no MCP identifier. The default path is `/callback`, configurable globally. Requests are routed to their authorization flow **only** by the OAuth `state` parameter.
- **Authorization sessions keyed by `state`**, independently of server ids: concurrent flows for different servers and for the same server, single-use consumption, ten-minute expiry, and per-server isolation of client registration and tokens.
- **Flexible redirect resolution** with one precedence order: per-server complete-URI override → global fixed configuration → automatic allocation. Automatic mode picks an available loopback port and presents `localhost` with `/callback`; fixed mode never changes the selected port silently.
- **Global callback configuration** (mode, hostname, port, path) persisted in the plugin state file and editable through the API and the Settings → MCP **Advanced** section, with a status line that stays visible while the section is collapsed.
- **Per-server `redirectUrl`** now accepts a complete redirect URI with an optional port and path; an omitted port or path inherits the global fixed configuration when the mode is fixed, and an omitted port allocates automatically otherwise.
- **BREAKING**: `config.publicOrigins` is removed from the OAuth flow (it existed only for this callback), so non-loopback and `https` redirect values are rejected; the GUI callback route and its `/mcp-manager/callback/<id>` URI are removed; a reverse-proxy deployment must now forward the callback port to the loopback listener.
- **BREAKING**: a stored non-loopback `redirectUrl` no longer silently falls back to a derived default — it fails the next authentication with an actionable message while the stored value stays intact.
- Refactor that the change removes the need for: delete the request-derived origin helpers, stop threading a redirect context through the view builders, pin the session explicitly at token exchange, unify the two authorization entry points, extract the callback page, and reuse one loopback predicate instead of two.
- Ship as release 0.18.0 with both READMEs in sync and an upgrade section for 0.17.x.

## Capabilities

### New Capabilities
- `oauth-callback`: the centralized callback subsystem — dedicated loopback listeners, listener sharing and path routing, `state`-keyed session lifecycle (creation, single-use consumption, expiry, cancellation), isolation between connections, start/stop ownership, and the diagnostics it reports.

### Modified Capabilities
- `oauth-redirect-url`: the default URI is no longer derived from the request that starts authorization but allocated by the callback subsystem; the per-server override becomes a complete URI whose port and path may inherit the global fixed configuration; validation narrows to loopback literals; `publicOrigins` stops participating; the pinned-URI-per-attempt and registration-lifecycle requirements remain.
- `mcp-settings-ui`: adds the global callback configuration in a collapsible **Advanced** section with an always-visible status line, changes the per-server redirect field to a complete URI with a host-provided preview, and defines what the card shows in automatic mode plus where callback diagnostics appear.

## Impact

- `lib/index.js` (host half): `startAuth`, `exchangeCode`, the callback route, `pending`, `redirectContext`/`browserOrigin`/`localGuiPort`/`redirectOriginFor`/`parseRedirectParts` and related helpers (roughly 200 lines), `ensureClientId`, both authorization endpoints, `serverView`/`workspaceServerView`/`listWorkspaces`, `GET /settings`, the `PUT`/`POST` handlers that carry `redirectUrl`, and the plugin teardown hook.
- New host modules under `lib/oauth/` (`callback-manager`, `redirect-resolver`, `session-store`, `callback-page`), plus `package.json` `files` coverage so a published package ships them.
- `lib/client.js`: the Advanced callback section with its status line, the complete-URI redirect field, the automatic-mode card content, and new `mcp` locale keys in both `zh` and `en`.
- State on disk: `~/.dsh/mcp-manager.json` gains a top-level `oauthCallback`; `redirectUrl` keeps its key but accepts the wider shape. No data migration; existing loopback-shaped values remain valid and non-loopback ones fail loudly at authentication.
- Removed configuration: `config.publicOrigins` and the paths and docs that describe it.
- Tests: new host suites for the listener manager, the session store, redirect resolution and an end-to-end callback through a real socket; `test/redirect-url.test.js` is replaced; `test/oauth-discovery.test.js` assertions move from a literal URI to its shape; the client suite covers the Advanced section, the status line and both locales.
- Docs: `AGENTS.md` (source layout and architecture rules), `README.md`, `README.zh-CN.md`, `docs/release-v0.18.0.md`, `package.json` version 0.18.0.
- Unchanged: OAuth discovery, dynamic client registration, PKCE, scope selection, token persistence and refresh (refresh never needs a listener), tool naming, transports, workspace scoping and the on-demand broker.
- No new dependencies; Node built-ins only.
