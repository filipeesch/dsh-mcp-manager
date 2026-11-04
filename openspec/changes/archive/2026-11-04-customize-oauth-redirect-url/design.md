# Design

## Context

See `proposal.md` for motivation. Current state that shapes the approach:

- The redirect origin is derived per request by one helper that trusts a loopback `Host`, a complete `X-Forwarded-Proto`/`X-Forwarded-Host` pair whose origin is listed in `config.publicOrigins`, or the single configured public origin. A non-strict mode falls back to `http://127.0.0.1` **without a port**.
- The absolute URI is built by `callbackFor(origin, serverId)`, and the same expression is repeated at three points: dynamic client registration, the authorization request, and the token exchange. The exchange is invoked from the callback route with an origin derived from the *callback* request, not from the request that started the flow.
- `server.oauth.redirect` caches the URI a registration was made with. Registration is bound to the exact `redirect_uri`; a re-registration drops the replaced client's token pair.
- Per-server OAuth configuration (`clientId`, `clientSecretEnv`, `clientName`, `scope`) lives at the server object's top level, mirrored into `mcpServers[name]` entries for workspace servers, with readers/writers in `normalizeWorkspaceServer` and `buildWorkspaceEntry` and a comparison in `sameServerConfig`.
- Views (`serverView`, `workspaceServerView`) are built on the host side; the client only renders them. The Settings → MCP page polls the server and workspace lists, puts global cards in a two-column grid, and repeats the switch/authenticate/edit/delete cluster in two components.
- Constraints: no dependencies, two half-files (`lib/index.js`, `lib/client.js`), every user-visible string in both locales, an annotated tagged release, and the standing rule that a request must never be able to aim the callback at an arbitrary origin.

## Goals / Non-Goals

**Goals:**

- One place decides the redirect URI, and one value is used for a whole authorization attempt.
- An operator can make a server present `localhost` (or another loopback/public alias) instead of the derived default, without the value rotting when the GUI port changes.
- Changing the URI never signs an authenticated server out, and the page says when a registration is behind the configured value.
- The card's action area cannot overflow at any width the page produces.

**Non-Goals:**

- Running a second HTTP listener on a fixed port, or accepting a redirect path other than the plugin's own callback route. A custom URL is an alias for the GUI's callback; anything that must reach the plugin has to route to the GUI.
- Changing registration identity rules, PKCE, scope selection, discovery, transports, tool registration, workspace scoping or the on-demand broker.
- Refactors beyond what this change removes: the two view builders and the duplicated action clusters stay as they are, except for the additions this change needs.
- Migrating stored state. An absent `redirectUrl` means "derived default", so no version-2 migration is introduced.

## Decisions

### D1 — Store an origin-shaped override, not a full URL

`redirectUrl` holds `host`, `host:port` or `scheme://host[:port]`; the path is always the plugin's callback path and is never stored. The value is resolved into an absolute URI at the moment a flow starts.

- *Why*: the GUI port is allocated per start, so any stored port that is not deliberately pinned rots immediately. Keeping the value origin-shaped also makes the security check (loopback or allowlisted origin) a single comparison, and prevents a stored path from disagreeing with the route that actually receives the code.
- *Alternatives*: a full URL (rejected — freezes the port and duplicates the path); a `{port}` placeholder template (rejected — a new syntax for one field); storing only a hostname (rejected — the public-proxy case needs an explicit port and scheme).

### D2 — One resolver, and the value is pinned per attempt

A single `redirectUriFor(server, requestOrigin)` returns the absolute URI: the resolved override when present, otherwise the derived default. `startAuth` fixes it into the pending attempt record (`state`, `verifier`, `redirectUri`), and the token exchange reads it from that record instead of receiving an origin.

- *Why*: the exchange cannot reconstruct an override from the callback request — that request may carry a different host, and behind a proxy it may carry none that the plugin trusts. Pinning also fixes the existing failure where the callback's origin differs from the authorize origin, and removes the temptation to keep two derivations in sync.
- *Alternatives*: recompute at exchange and consult the configuration only when an override exists (rejected — the proxy case stays broken and the derivation stays duplicated); store the origin in the flow and rebuild the URI twice (rejected — two chances to disagree on the path).

### D3 — Port inheritance at resolution time

When the override parses without an explicit port, resolution reuses the port the request reached the GUI on locally: the port named by a loopback `Host`, otherwise the listening port the connection landed on. The browser-facing origin cannot supply it, because a configured public origin usually has no port and its scheme default (443) would name an unreachable loopback URI. An explicit port is used verbatim. A missing port on a non-loopback allowlisted origin keeps the scheme's default port, because that origin is compared against `publicOrigins` as configured.

- *Why*: the common case is `localhost` on the same port as the GUI; inheritance makes it survive a restart. The proxy case needs an explicit port anyway, and inventing an inheritance rule for public hosts would silently produce an origin that is not in the allowlist.
- *Alternatives*: inherit the port for every host (rejected — produces non-allowlisted origins); require a port everywhere (rejected by the operator decision).

### D4 — Validation lives in the existing pure field parser

`parseOauthFields` validates the new field (shape, no path/query/fragment/userinfo, loopback or allowlisted host, `https` only when the origin is allowlisted) and `applyOauthFields` persists it. Both editors already call these, so the rule exists once for the global PUT, the workspace PUT/POST, and hand-written workspace files.

- *Why*: two editors, two config formats, one validator; it is pure, so the caller can validate before mutating anything.
- *Alternatives*: validate in the request handlers (rejected — duplicated across four routes); validate lazily at authorization time (rejected — a bad value would be stored and only fail much later).

### D5 — Saving never invalidates; re-registration stays lazy

Saving a new `redirectUrl` does not touch `server.oauth`, and the field is deliberately excluded from the PUT handler's client-identity tuple. `ensureClientId` remains the only place that re-registers, because it already compares `oauth.redirect` with the URI it is about to use.

- *Why*: the stored token pair still refreshes through the old client, so the operator keeps working until they choose to authenticate again; and the registration path keeps a single owner.
- *Alternatives*: eager invalidation on save (rejected by the operator — it would sign out servers for an edit that has not been applied yet); a "pending" flag in the state file (rejected — it is derivable from `oauth.redirect` versus the effective URI).

### D6 — The host reports the effective URI; the client does not guess

`serverView` and `workspaceServerView` include the effective redirect URI, computed with the origin of the request that asked for the list, plus a boolean saying whether the stored registration was made with it. The configured override travels in the view as well, so the form can round-trip it.

- *Why*: only the host knows `publicOrigins`; a client computing from `window.location` would be wrong exactly for the proxied deployments this field is meant to serve. The list already carries per-server state, so this costs no extra round trip.
- *Alternatives*: a dedicated endpoint per card (rejected — an extra request for a value the list already needs); exposing `oauth.redirect` raw and letting the client compare (rejected — the comparison needs port inheritance, which is host-side knowledge).

### D7 — Remove the callback route's origin derivation

With the exchange pinned, the callback route no longer needs to derive an origin, so the non-strict mode of the origin helper and its port-less fallback disappear; the helper is only ever used with the strict option that fails loudly.

- *Why*: deleting the only consumer removes the port-less fallback that produced an unusable callback URI, and it is the change's own cleanup rather than an unrelated refactor.
- *Alternatives*: keep the non-strict mode for future callers (rejected — an unused fallback that silently drops the port is a trap).

### D8 — Card actions: switch, authenticate, menu

The action area becomes the enable switch, the authenticate action (with its existing label variants), and a `⋯` menu holding Edit and Delete, in both the global and the workspace card. The menu closes on outside click and Escape, reports its expanded state, and keeps the existing delete confirmation. CSS gains wrapping on the action containers and a minimum card width so the grid collapses instead of overflowing.

- *Why*: it removes the two widest controls from the layout while keeping the primary action one click away, and it fixes the same defect in both places instead of only the global card.
- *Alternatives*: wrapping only (rejected by the operator); icon-only buttons (rejected — worse discoverability and accessibility); moving only Delete into the menu (rejected — not enough width saved).

### D9 — Field placement and naming

`redirectUrl` sits at the server object's top level next to `clientId` and `scope`, not inside `oauth`; workspace entries mirror it, and both views expose it.

- *Why*: `oauth` holds secrets, tokens and discovery caches; operator-facing configuration in this plugin is stored beside the other credential fields. A top-level field also keeps `sameServerConfig` and the external-edit adoption list trivial to extend.
- *Alternatives*: `oauth.redirectUrl` (rejected — mixes configuration with secret state and would be cleared by the identity invalidation that deletes `oauth`).

### D10 — Verification shape

A host-half suite covers resolution (default and override, port inheritance, public origin), validation (each rejection), pinning (all three requests carry one URI; a differing callback host changes nothing), the lifecycle (save keeps tokens, next authentication re-registers, manual Client ID never registers) and workspace entries (override used, preserved by a partial edit, honored from a hand-edited file). A stub client test covers the field, the menu behavior and the presence of the new keys in both locales. Existing OAuth, discovery, workspace and client suites are re-run unchanged.

- *Why*: the behavior is observable through the existing API-level test harness, and the risky part is the lifecycle, not the parsing.

## Risks / Trade-offs

- [An override with an explicit port that nothing listens on] → the form shows the effective URI, the attempt log keeps the failed request, and the documentation states that a port other than the GUI's requires a relay that forwards to the GUI.
- [The GUI port changes between restarts] → an override without an explicit port inherits the current port at resolution time; an override with an explicit port is the operator's stated intent and is used verbatim.
- [`localhost` resolving to `::1` while the GUI listens on `127.0.0.1`] → the browser falls back to the other address for loopback, and a failure is visible in the attempt log's exchange entry; the docs name the loopback URL as the guaranteed-reachable form.
- [Removing the non-strict origin helper branch touches the callback route] → covered by the existing callback-session tests plus a new case where the callback's Host differs from the Host used to authorize.
- [A workspace file edited by hand may carry an invalid override] → the loader ignores an invalid optional OAuth field, exactly like the other optional fields, and the value is validated again when saved through the UI.
- [Edit and Delete move behind a menu] → both keep text labels and the menu reports its state; the delete confirmation is unchanged, so the safety net stays.
- [More fields on the server objects] → the view builders and the comparison function must carry the new field; the spec and tasks name every place so none is silently missed.

## Migration Plan

- No data migration: an absent `redirectUrl` resolves to the derived default, and existing `oauth.redirect` caches stay valid because they are only compared when a registration is about to happen.
- Release as 0.17.0: bump `package.json`, sync `README.md` and `README.zh-CN.md`, commit on `main`, then create and push an annotated `v0.17.0` tag.
- Deploy: `dsh plugin --profile web add <repo>#v0.17.0`, restart the profile, reload the page.
- Rollback: install the previous tag; servers keep their stored tokens because nothing in this change rewrites the token record.
