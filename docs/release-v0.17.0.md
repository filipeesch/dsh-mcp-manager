# v0.17.0: per-server OAuth redirect URL

Related board task: *Redirect url customization*.

The plugin decided the OAuth redirect URI itself: it derived the origin from the
`Host` of the request that started authorization and appended
`/mcp-manager/callback/<server-id>`. Opening the GUI at `127.0.0.1` therefore
always produced `http://127.0.0.1:<port>/...`, so an authorization server that
only accepts `localhost` (or another loopback alias) could not be used at all.
Two defects sat next to it: the token exchange re-derived the origin from the
*callback* request, so a callback arriving through a different host (a proxy, a
forwarded header outside the allowlist) failed with `invalid_grant`; and the MCP
server card's action row, with authenticate, edit and delete all present, could
overflow the card.

## Changes

- New optional, non-secret `redirectUrl` per server, in `~/.dsh/mcp-manager.json`
  and in a workspace `mcpServers[name]` entry. It accepts `host`, `host:port` or
  `scheme://host[:port]`; the callback path is always the plugin's, so a value
  carrying a path, query, fragment or credentials is rejected.
- One resolver decides the redirect URI. Without an override the default is
  unchanged in shape but always names a loopback address: a `localhost` request
  host becomes `127.0.0.1` (the port the browser used is kept), and a single
  configured `publicOrigins` origin is used verbatim. A loopback override that
  omits the port inherits the port the request reached the GUI on locally — the
  loopback `Host` port, or the listening port the connection landed on when a
  proxy forwarded the request — so it survives a restart on another port and
  stays correct when a configured public origin names the browser-facing
  callback (that origin usually carries no port, and its scheme default would
  name an unreachable `localhost:443`). An explicit port is used verbatim; a
  non-loopback (allowlisted) origin keeps its scheme's default port, and an
  allowlisted origin written with its explicit default port
  (`https://host:443`) is accepted for the allowlisted origin `https://host`.
- Validation lives in the shared optional-OAuth-field parser: only a loopback
  host or an origin listed in `config.publicOrigins` is accepted, and `https` on
  a loopback host is rejected unless it is allowlisted, because the callback
  receiver is plain HTTP. A rejected value is never persisted.
- The redirect URI is fixed when an authorization starts and replayed for the
  dynamic registration, the authorization request and the token exchange. The
  callback route no longer derives an origin, which also removes the port-less
  `http://127.0.0.1` fallback.
- Saving a new redirect URL does not touch the stored registration or tokens;
  the card reports the effective URI with a copy action and a *registration
  pending* note, and the next Authenticate re-registers a dynamically registered
  client for the new exact redirect (the replaced client's pair is dropped then).
  A manually configured Client ID is never re-registered.
- Settings → MCP: a **Redirect URL** field (effective default as placeholder,
  clear-to-default, re-registration notice) and, on both the global and the
  workspace card, the action area becomes the enable switch, the authenticate
  action and a `⋯` menu holding Edit and Delete. The card grid now collapses to
  one column instead of overflowing, and the action rows may wrap.
- Both READMEs document the override, the port inheritance, the
  loopback/allowlist rule and the `localhost` → `127.0.0.1` default change.
- **Upgrading from 0.16.x:** a request addressed to `localhost` now yields the
  loopback IP. A provider that allowlists only `localhost` needs
  **Redirect URL** set to `localhost`; the existing registration keeps
  refreshing until the next authentication, which re-registers for the new URI.

## Verification

Verified on macOS arm64 with owned loopback fixtures and disposable profile
paths (`HOME`/`USERPROFILE`/`DSH_HOME` are redirected before the plugin module is
imported).

- `npm test`: 287 passed, 0 failed, 0 cancelled, 0 skipped on Node v24.21.0.
- `test/redirect-url.test.js` (13 tests) covers the derived default including the
  `localhost` → `127.0.0.1` normalization and a configured public origin used
  verbatim; the override with an inherited port (direct and behind a proxy, and
  with a public origin configured), an explicit port and an allowlisted `https`
  origin — including one written with its explicit default port; rejection of a
  non-allowlisted host, a path, a non-http scheme, credentials and `https` on
  loopback, with the stored value unchanged after a rejected `PUT`; the pinned URI
  at the token exchange when the callback is addressed to a foreign host; the
  save-then-re-register lifecycle (tokens kept on save, the kept registration
  still refreshing a revoked token, the old pair dropped only when the next
  authentication replaces the client, and the pending cue clearing once they
  match); a manual Client ID that never registers; a `redirectUrl` hand-edited
  into the state file; and workspace entries (override used, preserved by a
  partial edit, reloaded after a hand edit, and driving a real workspace
  authorization after the workspace is loaded).
- `test/client-language.test.js` covers the redirect field with the
  default-without-override placeholder and its reset action, the re-registration
  notice (and the manual-Client-ID variant), the effective URI with a copy action
  whose clipboard payload is asserted, the pending-registration cue, and the menu
  (closed by default, `aria-expanded`, Edit/Delete items, closes after choosing
  and on Escape).
- `test/oauth-discovery.test.js` was updated where the derived default now names
  the loopback IP: a `localhost` Host registers `http://127.0.0.1:<port>/...`.
  Its other cases (allowlisted origins, application type, re-registration on a
  changed origin) still pass unchanged.

Not verified here: a live browser OAuth round trip through a real provider with a
`localhost` override, the card layout in a running DSH web profile, and the menu's
outside-click close (implemented with a capture-phase document listener, which the
VM-based client stub cannot exercise). All of them require an installed plugin and
a browser; see the next gate in the README.
