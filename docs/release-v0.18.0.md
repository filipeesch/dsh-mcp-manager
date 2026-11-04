# v0.18.0: centralized OAuth callback infrastructure

Related board task: *OAuth callback refactor* (Open Spec v1).
OpenSpec change: `centralize-oauth-callback`.

The OAuth callback used to be a route on the DSH GUI webserver
(`GET /mcp-manager/callback/<server-id>`). It therefore inherited the GUI's
host, port and lifecycle: a profile without a webserver could never receive a
code, the redirect could not be a port the operator pinned, and the URL had to
carry an MCP server id. Routing by that id also allowed only one pending flow
per server, with no expiry and no listener to start or stop.

This release replaces it with a subsystem that owns the callback transport.

## Changes

- New `lib/oauth/` modules:
  - `callback-manager.js` — loopback HTTP listeners: one port per listener, one
    socket per bound loopback address, a per-listener path table and refcounted
    release.
  - `redirect-resolver.js` — pure policy: loopback predicates, callback path
    normalization, global configuration validation, complete-URI override
    parsing, and the `override → fixed → automatic` precedence.
  - `session-store.js` — pending authorizations keyed by the OAuth `state`
    (32 random bytes, single use with a replay tombstone, ten-minute expiry,
    per-connection index).
  - `callback-page.js` — the HTML page and its write helper (no-store,
    `Connection: close`).
- The callback URL is `http://localhost:<port>/callback` by default: no server
  id, no GUI port, routing by `state` alone. The path is configurable globally.
- Listeners start when an authorization starts and stop when no pending flow
  needs them; `localhost` binds `127.0.0.1` and `::1` (IPv4 fallback when IPv6
  is unavailable); a fixed port is bound verbatim and a busy one fails loudly.
- Authorization sessions support concurrent flows — different servers and
  several flows for the same server — with per-session client identity, redirect
  URI and PKCE verifier, and token writes restricted to the session's own
  connection.
- Global callback configuration (`oauthCallback`: mode, hostname, port, path) in
  `~/.dsh/mcp-manager.json`, exposed through `GET /settings` (with live
  `callbackStatus`) and `PUT /settings/callback`, and editable in a collapsible
  **Advanced → OAuth callback** section whose header always shows the mode, the
  listener count and an error indicator.
- Per-server `redirectUrl` now accepts a complete `http://host[:port][/path]`.
  An omitted port/path inherits the fixed global configuration; otherwise the
  port is allocated and `/callback` is used. The card reports the effective URI,
  or — in automatic mode — that the port is assigned at authentication plus the
  URI the last authentication used, and warns when a manual Client ID cannot
  follow a changing URI.
- Server cards are simpler: they start collapsed, the expanded body holds only
  the controls (enable switch labelled `Enabled`/`Disabled`, **Logs**, **Edit**,
  **Delete**) and the log panel below them, and no configuration text. The
  needs-auth status badge is the authentication action; the menu is gone and the
  action row wraps instead. The effective redirect URI, its copy action, the
  pending-registration state and the redirect warnings moved to the edit form.
- Callback diagnostics: new `callback-listener` and `callback-receive` attempt
  phases, plus the last listener error in the Advanced section. `state` stays
  redacted from logs (it is now the only routing key).
- Refactors removed with the old design: `browserOrigin`, `localGuiPort`,
  `portOfOrigin`, `normalizeLoopbackHost`, `redirectContext`,
  `redirectOriginFor`, `parseRedirectParts`, `parseRedirectOrigin`,
  `REDIRECT_ORIGIN_RE`, the per-server `pending` map and the GUI callback route.
  The two authorization entry points share one `startAuthorization`, the token
  exchange receives the validated session explicitly, `startAuth` is split into
  preparation and URL construction, and the loopback predicate is shared with
  the registration `application_type` classification.

### Hardening from the independent review

- Concurrent acquisitions of the same address await one in-flight bind, so two
  tabs no longer turn the plugin's own bind into a reported `EADDRINUSE`; a
  guard now only reports a busy port the plugin does not own.
- `acquire` returns a single-use grant and only that grant may release it, so a
  late or duplicated release can never close a listener another flow re-created
  on the same port. A failed authorization start also removes its session.
- Disabling, deleting or renaming a workspace server — and a rescan that drops
  it — cancels its pending authorization, and a callback can no longer
  reconnect a server that was deliberately disabled while the flow was pending.
- The session pins the client identity, secret and token-endpoint auth method;
  a concurrent flow that re-registered the client cannot make the exchange send
  one client's id with another's secret, and the stored registration is
  re-pointed at the client that completed last so the pair stays refresheable.
- A reaped session reports "expired" rather than "already completed" (the
  tombstone carries the outcome).
- An unservable stored redirect value names the value and the accepted forms in
  the error (host is checked before scheme, so `https://public-host` reports the
  reason that matters), and a hand-edited invalid global callback configuration
  is surfaced in the Advanced section and fails an authorization start loudly
  instead of silently degrading to an automatic address.
- The provider `error` text on the callback page goes through the same redactor
  as the log; the authorization endpoint must be an http(s) URL; the page's
  back-link is loopback-only.
- The Advanced form keeps a draft only while the operator edits it, so it shows
  the stored configuration delivered by the poll instead of the defaults from
  its first render (which Save would otherwise write back). The automatic-mode
  field placeholder no longer looks like a final URI, and an override without a
  port is presented as "the port is assigned at authentication" — including for
  a manually configured Client ID.

## Breaking changes

- `config.publicOrigins` no longer participates in OAuth (it existed only for
  this callback). A reverse-proxy deployment must expose the callback listener
  itself, for example with a fixed port forwarded to loopback.
- The callback path changed from `/mcp-manager/callback/<server-id>` to
  `/callback` (or the configured path), and the port is no longer the GUI's.
  Any redirect URI entered by hand at a provider must be registered again.
- A stored non-loopback `redirectUrl` (for example
  `https://relay.example.com`) is not rewritten: the next authentication fails
  with a message naming the value and the card flags it. Stored tokens keep
  refreshing until then.
- Automatic mode allocates a port per authentication, so a manually configured
  Client ID needs a fixed callback configuration or a per-server override.

## Verification

Verified on macOS arm64 (darwin) with Node v24.21.0, using disposable
`HOME`/`USERPROFILE`/`DSH_HOME` paths and loopback fixtures. No real provider or
browser round trip was performed here.

- `npm test`: **330 passed, 0 failed, 0 cancelled, 0 skipped**
  (`duration_ms` ≈ 75 s).
- New suites:
  - `test/oauth-callback-manager.test.js` — automatic allocation and port
    release, listener sharing across paths, 404/405 handling, fixed-port reuse,
    a busy fixed port failing with `EADDRINUSE` (cause preserved) and no
    fallback, two fixed ports, dual-stack widening (skipped when the host has no
    IPv6 loopback), concurrent binds sharing one listener, stale/duplicate
    releases being ignored, and `closeAll`.
  - `test/oauth-session-store.test.js` — unique states, single use, replay
    tombstones, ten-minute expiry with an injected clock (including the reaper
    reporting `expired`), per-connection index, concurrent flows for one
    connection, `remove`, `removeFor`, `clear`.
  - `test/oauth-redirect-resolution.test.js` — loopback predicates, IPv6 URL
    formatting, path normalization, configuration validation, override parsing
    and canonicalization, precedence and inheritance, unservable stored values.
  - `test/oauth-callback-flow.test.js` — end-to-end through real sockets:
    listener ready before the authorization URL is returned, callback exchange,
    two servers sharing a listener, two flows for one server, unknown/replayed
    states, provider `error`, fixed mode plus a busy port, cancellation on
    delete/disable, unload, redirect lifecycle (save keeps tokens, next
    authentication re-registers, a manual Client ID never registers), a
    hand-edited override, a workspace override and an unservable legacy value;
    plus the global configuration (defaults, persistence, every rejection, a
    hand-edited invalid value, the cleared listener error), the view fields for
    automatic/fixed/override/manual-client, a rejected per-server save, a failed
    exchange releasing its port, and a disabled workspace server cancelling its
    pending flow.
- Migrated suites: `test/oauth-discovery.test.js` now asserts the callback shape
  and that a loopback registration is always `native`; `test/oauth-scope.test.js`
  and `test/oauth-dcr-client-name.test.js` deliver real callbacks;
  `test/oauth-resource.test.js` dropped the request-derived-origin cases and
  covers the loopback callback behind a proxy; `test/client-language.test.js`
  covers the Advanced section, its status line/error badge, the save request,
  the complete-URI field, the stored configuration surviving the first render,
  the automatic placeholder, the automatic-mode card notice and both languages. `test/redirect-url.test.js` was replaced by the four
  new suites.
- `openspec validate centralize-oauth-callback --strict`: valid.

Not verified here: a browser round trip against a real provider, binding an
explicit fixed port in a running DSH profile, a Windows host's `::1` behavior,
and the visual layout of the Advanced section in a live GUI. The IPv6 manager
test skips automatically where `::1` cannot be bound.
