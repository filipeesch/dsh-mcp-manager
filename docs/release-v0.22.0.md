# v0.22.0: expose the tools of a server that needs authentication

Related board task: *exibir mcp tools mesmo que não autorizadas* (Open Spec v1).
OpenSpec change: `expose-unauthenticated-mcp-tools`.

A server that fails authentication while connecting used to vanish from the
agent's view: `connect()` unregistered every tool it had, so the model never saw
them, never called one, and therefore never reached the conversation
authentication flow — which only exists for a call that is already registered.
The operator had to notice the state in Settings → MCP on their own.

This release keeps the server visible through the catalog it listed the last time
it worked, and gives the model an explicit way to ask for an authorization.

## Changes

- **A retained catalog per server.** The raw `tools/list` entries of each
  server's last successful listing are normalized (identity by name, ordering,
  a 200-entry / 128 KiB bound) and persisted in
  `~/.dsh/mcp-manager-tools.json` — a sidecar with no secret, its own lock and
  atomic writes, rewritten on every successful listing and discarded when the
  server is removed. A missing or corrupt file reads as empty and never blocks a
  connection.
- **Cached definitions while the server needs authentication.** A server
  reported as `needs-auth` registers its retained entries under the usual public
  names, with the server's own description and input schema, at both tiers and
  with the same broker deferral a live tool carries (`mcp_search_tools` and
  `mcp_execute_tool` reach them). Disabled, conflicting, erroring and not-yet-
  loaded servers expose nothing, and a server that never completed a listing has
  nothing to expose.
- **A call fails at once.** No wait, no attention entry, no retry: the error names
  the server and tells the model to call `mcp_authenticate_server("<server>")`.
  A `static` or stdio server keeps its own message and is told to update its
  token or command in Settings → MCP.
- **`mcp_authenticate_server({ server })`.** Registered while at least one
  configured server uses browser authorization (global or workspace). It resolves
  the name in the caller's scope, starts the same authorization Settings → MCP
  starts, opens the URL in the system browser, and returns immediately with the
  URL and an instruction. Over SSH it opens nothing and only returns the URL. A
  pending flow is reused instead of opening a parallel one, and the tool never
  enables a disabled server, changes configuration, or opens a URL the plugin did
  not create.
- **One announcement.** When the authorization completes and the server
  reconnects, the model receives a single notice, through dynamic model context
  (a user-role snapshot, not system-prompt text), stating that the server's tools
  are available again. It is emitted once and never repeats; a host without the
  prompt service drops it and logs once.
- **The card and the inventory endpoint follow the cache.** `GET
  /servers/:id/tools` answers `200 { tools, stale: true }` for a `needs-auth`
  server with a catalog, and keeps `409` for one without it. The card renders
  those names with a stale badge until the server reconnects.
- **One registration path.** Tool registration moved out of `lib/index.js` into
  `lib/tools/registration.js`; the catalog, its store and the authentication tool
  are focused modules with injected ports. A definition now resolves its live
  connection at attempt time, so a registration never holds a closed handle.
- **BREAKING (interface): English only.** The client no longer carries a second
  interface language or the host locale namespace, and `README.zh-CN.md` is gone
  from the repository, the package file list and the shipped README.

## Verification

- `npm test` — the host and client suites, including the new catalog, store,
  cached-exposure, inventory, authentication-tool, URL-opener and English-only
  cases.
- `openspec validate expose-unauthenticated-mcp-tools --type change --strict`.
