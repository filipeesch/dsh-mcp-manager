# Design

## Context

See `proposal.md` — Why. The current implementation that this design replaces:

- The callback is a route on the DSH GUI webserver, mounted lazily through `ctx.inject(['webServer'])` and matching `^/mcp-manager/callback/([A-Za-z0-9_-]+)$` (`lib/index.js:4352`). A profile without a web interface therefore has no callback at all.
- `pending` is a `Map<serverId, { state, verifier, redirectUri }>` (`lib/index.js:1073`, set at `:1607`, read and deleted at `:1629`). One pending flow per server, no expiry, and routing by the id in the URL.
- The redirect origin is derived from the request that starts authorization (`browserOrigin`, `localGuiPort`, `redirectContext`, `redirectOriginFor`, `parseRedirectParts`, all under `lib/index.js:4100-4335`), with `config.publicOrigins` acting as an allowlist for non-loopback origins.
- v0.17.0 added an origin-shaped per-server `redirectUrl` and pinned the resolved URI in `pending` for the exchange, so the token exchange no longer re-derives the origin. That pinning behavior is kept; the shape and the resolver around it are what change.
- Constraints that shape the approach: zero dependencies (Node built-ins only), host half in `lib/index.js`, client half is a single browser factory with no bundler, every user-visible string in `zh` and `en`, state writes go through the existing lock/merge, tests are `node --test` over exported helpers plus a stubbed `apply()`, and every visible change ships as an annotated tagged release.

## Goals / Non-Goals

**Goals:**

- Own the callback transport locally: one subsystem that binds, routes, and releases loopback listeners without any dependency on the web interface.
- Make the callback URL opaque: no MCP identifier anywhere in it, `/callback` as the default path, and routing by the OAuth `state` alone.
- Make an authorization attempt a first-class session with its own lifecycle (create, consume once, expire, cancel, release).
- Support the three real deployment shapes with one resolver: automatic loopback port, fixed global port, per-server override.
- Keep behavior that already works: PKCE, discovery, registration, token persistence and refresh, workspace isolation, and the presence of a single pinned redirect URI per attempt.
- Delete the code the new architecture makes unnecessary instead of leaving two paths side by side.

**Non-Goals:**

- Changing OAuth discovery, dynamic client registration, scope selection, token storage or the refresh protocol.
- Extracting discovery/registration/refresh out of `lib/index.js` (decided against: it is the stable path with the largest test surface).
- Sharing a listener across DSH processes, or coordinating sessions across processes. Two processes each own their own listeners; the state-file lock keeps covering writes only.
- Serving anything over TLS, or binding a non-loopback address.
- Resolving hostnames to decide whether a callback address is servable (see D4).
- Rewriting the `redirectUrl` key or migrating stored values (see D9).
- Reworking the two view builders, the workspace loader, or the client page beyond the fields this change touches.

## Decisions

### D1 — Four focused modules, dependency pointing one way

New `lib/oauth/` modules, imported by `lib/index.js`:

```
+----------------------------+      +--------------------------------------+
| lib/index.js               |----->| lib/oauth/redirect-resolver.js       |
|  startAuthorization()      |      |  resolve({override, global}) -> uri  |
|  onCallback(session, p)    |      +--------------------------------------+
|  exchange / reconnect      |----->| lib/oauth/session-store.js           |
|  views, API, status        |      |  create / consume / pendingFor       |
+-------------+--------------+      +--------------------------------------+
              |                    +--------------------------------------+
              +------------------->| lib/oauth/callback-manager.js        |
                                   |  acquire / release / status / close  |
                                   +--------------------------------------+
                                   +--------------------------------------+
                                   | lib/oauth/callback-page.js           |
                                   |  render({ok, message, returnUrl})    |
                                   +--------------------------------------+
```

The manager knows nothing about MCP connections: `acquire({ host, port, path, onRequest })` returns `{ uri, release }`, and `onRequest(request)` is supplied by `lib/index.js` per flow. The store knows nothing about HTTP. The resolver performs no I/O. `lib/index.js` remains the only place that maps a session to a server, an exchange, a reconnect and a status update.

*Why*: this is the smallest set of modules that keeps socket lifecycle, HTTP parsing, session lifecycle and redirect policy independently testable, and it is what stops the new subsystem from growing into the god class the old route avoided only by being small.

*Alternatives*: a single `lib/oauth-callback.js` (rejected — three lifecycles in one file); keeping everything in `lib/index.js` (rejected — the file is already 4877 lines and the callback would own another ~500); one class per concept including a `CallbackService` façade (rejected as ceremony over four plain modules).

### D2 — A listener is a set of loopback sockets on one port

`CallbackManager` owns a `Map<listenerKey, listener>` where a listener holds:

- `port` — one port shared by all its sockets;
- `sockets` — one HTTP server per bound address family (`127.0.0.1`, `::1`), because `localhost` may resolve to either;
- `paths` — `Map<normalizedPath, { refs, handler }>`, registered per flow;
- `refs` — the number of sessions currently relying on it.

`acquire` computes the families the requested host needs (`localhost` → both; `127.0.0.1`/other `127/8` → IPv4; `::1` → IPv6), then:

1. reuse a listener for the same explicit port whose sockets cover those families;
2. otherwise, add the missing family sockets to that listener on its existing port;
3. otherwise (automatic mode, or the port cannot take the extra family) create a new listener.

`release` decrements the path and listener refs and closes every socket of a listener whose refs reach zero.

*Why*: one port with several sockets is the only way to keep `localhost` working on both families without allocating two ports, and a refcount is what makes "do not stop while another flow is pending" a property of the data rather than of a check in the right place.

*Alternatives*: one server bound to `::` with `ipv6Only: false` (rejected — it would accept non-loopback connections, violating the loopback-only rule); bind `localhost` by name (rejected — Node resolves it to a single address, so the other family fails silently); reuse only exact `host:port` keys (rejected — `localhost` and `127.0.0.1` on the same port would collide instead of sharing).

### D3 — Automatic allocation binds port 0 once, then widens

For an automatic listener the manager binds IPv4 on port `0`, reads the assigned port, and then attempts `::1` on that same port. If the IPv6 bind fails (IPv6 disabled, or the port taken on that address) the listener keeps the IPv4 socket and is marked IPv4-only; the presented URI stays `http://localhost:<port>/callback`, because a browser that resolves `localhost` to `::1` falls back to the IPv4 address for a loopback destination.

Presenting the URI before binding is impossible by construction: the URI is built from `listener.port` after `listen` reports it.

*Why*: binding port 0 removes the allocate-then-bind race; widening afterwards is best effort, and losing IPv6 degrades to the documented fallback instead of failing the flow.

*Alternatives*: probing for a free port with a scratch socket and then binding it (rejected — that is exactly the TOCTOU race); binding IPv6 first (rejected — it fails on hosts with IPv6 disabled, the common case being the one where it matters least).

### D4 — Resolution precedence and inheritance, pure and I/O-free

`resolveRedirect({ override, global, requestedFamilies })` returns `{ uri, host, port, path, mode, source }` or throws a typed error:

1. **Override present** — parse `scheme://host[:port][/path]`. Host must be a loopback literal, scheme must be `http`; no query, fragment or userinfo; a path, when present, starts with `/`.
   - explicit port → fixed listener on that port;
   - no port → the global fixed port when `global.mode === 'fixed'`, otherwise an automatic port;
   - explicit path → that path; no path → the global fixed path when the mode is fixed, otherwise `/callback`.
2. **No override, global fixed** — global hostname, port and path, with the port required.
3. **Neither** — automatic allocation with `localhost` and `/callback`.

A stored override whose host is not a loopback literal or whose scheme is not `http` is not rewritten and does not fall back: the resolver throws, the attempt fails, and the message names the stored value.

*Why*: one function, no I/O, no request context, so the same inputs always produce the same URI and the whole policy is unit-testable. Rejecting instead of falling back is the "never silently change a fixed redirect URI" rule applied to stored configuration as well as to runtime retries.

*Alternatives*: resolve hostnames to accept an `/etc/hosts` alias (rejected — an I/O-bound, machine-dependent answer inside a policy function); validate by binding at save time (rejected — see D8); keep `publicOrigins` as a compatibility escape hatch (rejected — the listener cannot serve a public origin without a relay, and a relay recreates the coupling this change removes).

### D5 — Path normalization is one function used by both sides

`normalizeCallbackPath(value)` accepts a non-empty path starting with `/`, rejects `?`, `#`, `..`, control characters and backslashes, collapses duplicate slashes, and is applied both when a configuration is saved and when a listener route is registered. Requests are matched on the normalized path with an exact compare; a path that does not match any registered route gets `404` and never reaches the session store.

*Why*: the URL is presented to a third party and compared later; one normalizer means a saved configuration and a registered route cannot disagree.

*Alternatives*: prefix matching (rejected — a registered `/callback` would swallow `/callback2`); no normalization (rejected — `/callback/` and `/callback` would be different listeners entries for the same intent).

### D6 — Sessions are keyed by state, with tombstones for replay

`SessionStore` holds `Map<state, session>` and a `Map<state, expiredAt>` tombstone for consumed states, kept until the original expiry:

- `state` is 32 random bytes, base64url, generated per attempt;
- `create(session)` stamps `createdAt` and `expiresAt = createdAt + 10 min` and returns the state;
- `consume(state, now)` returns `{ status: 'ok', session }`, `'unknown'`, `'expired'` or `'consumed'` and removes the entry on `ok` or `expired` (recording a tombstone in both cases);
- `pendingFor(serverId)` powers the status view and "does this connection still have a flow?";
- `expire(now)` is driven by a timer and also called lazily on `consume`, so a clock jump cannot leave a valid session behind;
- `clear()` is used on unload.

The store takes a `now` function so tests advance time without sleeping.

*Why*: the state is the routing key and the replay guard at once; a tombstone is what lets a replayed callback say "already completed" instead of "unknown", which the diagnostics requirement asks for.

*Alternatives*: keep the per-server map keyed by id (rejected — forbids concurrent flows and puts MCP identity in the URL); consume by deleting and treat every miss as unknown (rejected — indistinguishable replay); persist sessions to disk (rejected — a pending authorization is not worth a secret-at-rest surface, and restart cleanup is a requirement).

### D7 — Completion is an injected handler, and the manager never exchanges

`lib/index.js` owns `startAuthorization(server)`:

1. adopt external auth edits (unchanged);
2. resolve the redirect (D4);
3. discover metadata and ensure a client id for the *resolved* URI (unchanged path);
4. `manager.acquire(...)` and register the path with `onRequest = (params) => completeAuthorization(session, params)`;
5. create the session (D6) and return the authorization URL, which can only be built after a successful bind (D3).

`completeAuthorization(session, { code, state, error })`:

- `state` mismatch or unknown → released session, error page, no token request;
- provider `error` → release, status `needs-auth` with the provider error, page explaining it;
- `code` present → `exchangeCode(session)` using the session's own client id, redirect URI and verifier (replacing the `pending` lookup), persist, then `connect` or `reconnectWorkspaceServer` + `rebuildAgentWorkspace` exactly as today, then release;
- any thrown error → `recordAttempt`, status `error`, release, redacted page.

The callback page is rendered by `callback-page.js` with the same redactor the attempt log uses, and its "back to DSH" link uses the GUI origin captured from the request that started the flow (safe-host checked, otherwise omitted).

*Why*: the manager must not know about servers, and the exchange must use stored session context rather than anything read from the callback request.

*Alternatives*: let the manager call back into `index.js` through a service object with many methods (rejected — one function is enough); render the page inside `index.js` (rejected — it is the one piece that is pure string work and easy to test alone).

### D8 — Save validates shape, bind happens at authentication

The global configuration is validated by the same pure parser as an override: mode, loopback hostname, port range in fixed mode, normalized path. The save path never opens a socket. The port is bound when an authorization starts; a port conflict there produces the actionable error and aborts the attempt.

*Why*: a probe at save time does not reserve anything — the port can be taken a second later — so it replaces a clear failure with a false reassurance, while opening a socket outside a flow contradicts the lifecycle rule this change exists to enforce.

*Alternatives*: probe-bind on save (rejected); both (rejected — two code paths to keep in sync for no guarantee).

### D9 — `redirectUrl` keeps its key and gains a wider shape

The per-server field keeps the name `redirectUrl` and stays at the server object's top level (and in workspace entries). Its accepted shape widens from an origin to `scheme://host[:port][/path]`; every stored origin-shaped value (`localhost`, `localhost:8080`) remains valid and now means "that host, with an inherited or automatic port and the inherited or default path". `parseOauthFields`/`applyOauthFields` validate it, `sameServerConfig`, both views, `buildWorkspaceEntry`, `normalizeWorkspaceServer` and `EXTERNAL_AUTH_FIELDS` keep carrying it.

*Why*: no migration, no second key, and the existing adoption path for hand-edited files keeps working; the UI label becomes "Redirect URI", which is what providers call it.

*Alternatives*: rename to `redirectUri` (rejected — five compatibility points for a naming preference); split origin and path fields (rejected — two values that must agree).

### D10 — Global configuration lives in the state file, exposed through `/settings`

```json
"oauthCallback": { "mode": "automatic", "host": "localhost", "port": null, "path": "/callback" }
```

- `GET /settings` gains `oauthCallback` (sanitized) and `callbackStatus: { mode, listeners: [{ host, port, paths, pending }], lastError }`.
- `PUT /settings/callback` accepts the four fields, validates them, persists under the state lock, and returns the new configuration plus status.
- An absent `oauthCallback` means automatic defaults, so no migration is needed.
- `lastError` is in memory only, like the attempt logs.

*Why*: the interface already writes profile settings through this API and the state file already has the lock/merge discipline this needs; `publicOrigins` is being removed, so there is no second source to reconcile.

*Alternatives*: plugin config (rejected — not writable from the interface); config as default plus state override (rejected — two sources and ambiguous diagnostics).

### D11 — Views report what is knowable, and nothing else

- `redirectDefaultUri` (the field placeholder) is the fully resolved URI in fixed mode and a template naming the automatic port otherwise.
- `redirectUri` is the final URI when it is knowable (fixed mode, or an override with an explicit port); in automatic mode it is empty and `redirectLastUsedUri` carries the URI the last successful authorization used.
- `redirectPending` keeps its meaning only where a final URI is knowable; it compares `oauth.redirect` with it.
- `redirectMode` is `automatic`, `fixed` or `override`, which is what drives the card's wording.
- `redirectWarning` is set for a manual `clientId` under an automatic mode and for a stored value the resolver rejects.

*Why*: only the host knows the global configuration and the resolver, and inventing a port for display would be a lie that the operator would copy into a provider.

*Alternatives*: reserve the automatic port at startup so a URI can be shown (rejected — keeps a port open without a flow and still changes per restart); let the client compute from `window.location` (rejected — the client cannot know the configuration).

### D12 — The interface turns the redirect field into a URI field and the globals into an Advanced section

- The server form field accepts a complete URI, keeps the clear-to-default action, and its placeholder comes from `redirectDefaultUri`.
- The automatic-mode card says the port is assigned at authentication, shows the last used URI with the copy action, and warns for a manual client id.
- Settings → MCP gains an **Advanced** section, collapsed by default, whose header always shows mode + listener count + error indicator; expanding reveals mode, hostname, port, path, the active listener list and the full last error.
- All new strings are added to both `zh` and `en`.

*Why*: it matches how the page already works (polled list, inline blocks, one section component) and keeps the automatic default invisible to the operator who does not need it, which is the stated UX goal.

*Alternatives*: a separate settings section (rejected — a nav entry for one page's config); structured host/port inputs (rejected — the value operators copy from providers is a URI).

### D13 — Diagnostics get callback phases, and `state` is treated as sensitive

`recordAttempt` gains `callback-listener` and `callback-receive` phases alongside `authorize` and `token-exchange`. Every callback-side message goes through the existing `redactDetail`, which already strips `state=`, `code=` and token values from URLs and bodies; with `state` now the only routing key, that redaction is a requirement, not hygiene. The manager reports typed failures (`EADDRINUSE`, `EACCES`, `EADDRNOTAVAIL`, invalid configuration) that `index.js` turns into messages naming the address, port and cause and records on the affected server.

*Why*: the existing surfaces and redactor are sufficient; the only new thing is that failures can now originate before any HTTP request exists.

*Alternatives*: a new diagnostics store (rejected — duplicate of a working ring buffer); logging the full callback URL for debugging (rejected — it carries `code` and `state`).

### D14 — The refactor deletes what the new architecture replaces

Deleted: `publicOriginsOf`, `allowedPublicOrigins`, `browserOrigin`, `headerValue`/`isSafeHost`/`isLoopbackHost` where only the callback used them (the surviving loopback predicate moves into the resolver and is reused by `ensureClientId`), `localGuiPort`, `portOfOrigin`, `normalizeLoopbackHost`, `redirectContext`, `redirectOriginFor`, `parseRedirectParts`/`parseRedirectOrigin`, `REDIRECT_ORIGIN_RE`, the GUI callback route, the per-server `pending` map, and the `redirectCtx` parameter threaded through `serverView`, `workspaceServerView` and `listWorkspaces`.

Unified: `/servers/:id/auth` and `/workspaces/auth` call one `startAuthorization(server)`; `exchangeCode` takes a validated session; `startAuth` splits into preparation and URL construction; the callback page moves out.

*Why*: these are the lines the change already rewrites, and leaving them would keep a second, unused way to decide a callback origin.

*Alternatives*: keep the request-derived helpers behind a flag (rejected — an unused code path that silently drops ports is exactly the trap the previous change deleted); do the same cleanups for discovery/registration (rejected by decision — separate risk).

### D15 — Test shape

- `test/oauth-callback-manager.test.js` — bind on ephemeral ports, sharing by port, multiple paths, refcount release, IPv6 widening and fallback, fixed-port conflict, `closeAll`.
- `test/oauth-session-store.test.js` — injectable clock: single use, replay tombstone, expiry, per-server index, concurrent sessions, isolation.
- `test/oauth-redirect-resolution.test.js` — precedence, inheritance, validation rejections, unservable stored value, path normalization.
- `test/oauth-callback-flow.test.js` — real sockets plus the existing loopback authorization-server stub: authorize → callback → exchange → reconnect; two servers sharing a listener; two flows for one server; unknown and replayed states; provider `error`; listener release; plugin unload.
- Existing suites: `test/redirect-url.test.js` is replaced by the four above; `test/oauth-discovery.test.js` assertions move from a literal URI to its shape plus the fixed-mode configuration; client tests cover the Advanced section, the status line, the URI field and both locales.

A shared `test/helpers/oauth-harness.js` provides the stubbed `ctx` and the authorization-server stub for the new suites only; existing suites keep their inline harness so the diff stays reviewable.

*Why*: each module's failure mode is tested where it lives, and the end-to-end path is tested once through real sockets, which is the only way to prove "the listener is ready before the browser opens".

*Alternatives*: test everything through `apply()` (rejected — listener and store failures would only be reachable through convoluted fixtures).

### D16 — Release 0.18.0 with an upgrade section

Bump to 0.18.0, add `docs/release-v0.18.0.md`, update `AGENTS.md` (source layout now includes `lib/oauth/`, the callback architecture rules replace the redirect-origin rules), and both READMEs. The upgrade section states: `publicOrigins` is unused; a non-loopback `redirectUrl` fails the next authentication and must be corrected; a redirect URI registered at a provider must be re-registered with the new `/callback` URL; stored tokens keep refreshing until then.

*Why*: the repository convention requires a versioned, tagged release with synchronized docs, and this change breaks configuration.

*Alternatives*: 1.0.0 (rejected — the project does not claim that maturity); a patch release (rejected — hides a breaking change).

## Risks / Trade-offs

- [An operator with a pre-registered redirect URI in automatic mode] → the card warns and names the fix (fixed mode or a per-server override); the release notes repeat it.
- [A stored non-loopback `redirectUrl` now fails the next authentication] → the failure is loud and names the value, the stored value is untouched, and the upgrade section explains the correction; refresh keeps working so nothing signs out by itself.
- [F5 on the callback page after the listener closed] → connection refused instead of an "already completed" page; accepted, documented, and the reason the decision keeps expiry messaging on the page that does render.
- [Two DSH processes with a fixed port] → the second fails with an actionable `EADDRINUSE` message; automatic mode is unaffected because each process allocates its own port, and a callback always lands on the process that opened it.
- [`localhost` resolving to `::1` when only IPv4 could bind] → the IPv4 fallback covers it; the release note states the URL is loopback-reachable either way.
- [Windows hosts with IPv6 enabled but `::1` unbindable] → the IPv4-only path is a first-class branch with its own test, not an error path.
- [Real sockets in the test suite] → ephemeral ports, injected clock, and `after()` teardown; no sleeps.
- [Sibling flows overwrite each other's token pair] → accepted by decision: both belong to the same client and issuer, and the most recent success is the one stored.
- [Removing `publicOrigins` breaks a proxy deployment] → documented breaking change; the deployment must forward the listener port to loopback or use the GUI's own port as a fixed target only if the operator maps it.
- [The Advanced section hides the configuration] → the header keeps mode, listener count and error state visible, and the section is one click away.

## Migration Plan

- No data migration: an absent `oauthCallback` means automatic defaults; existing `redirectUrl` values keep their key and their loopback semantics.
- Release as 0.18.0: bump `package.json`, add the new modules to `files`, sync `AGENTS.md` and both READMEs, commit on `main`, create and push the annotated `v0.18.0` tag.
- Deploy: `dsh plugin --profile web add <repo>#v0.18.0`, restart the profile, reload the page.
- Upgrade behavior: stored tokens and registrations keep refreshing; the next authentication registers a dynamic client for the new URI; a provider that requires a pre-registered URI needs the new `/callback` URL whitelisted, or a fixed/override configuration that pins it.
- Rollback: install the previous tag. The previous version ignores `oauthCallback` and derives its URI from the request again, so no state change has to be undone, though a client registered for the new URI will re-register on the next authentication.

## Open Questions

- Whether the operationally useful half of `callbackStatus` (active listeners and last error) belongs in `GET /settings` or in a dedicated endpoint, if the 3-second poll of the settings payload turns out to be a meaningful cost. Deferrable: it does not change the specs, the approach or the task breakdown.
