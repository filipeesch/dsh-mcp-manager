# Design

## Context

See `proposal.md` for motivation. This section records only what shapes the approach.

**Repo shape.** The host half is one file, `lib/index.js` (4,918 lines at v0.21.0), plus focused modules: `lib/oauth/*` (listeners, sessions, redirect policy), `lib/auth/*` (waiters and recovery), `lib/servers/config.js` (pure configuration helpers), `lib/import/*` (JSON import). Plain ESM JavaScript, no TypeScript, no bundler; tests are `node --test` under `test/`. The client half is `lib/client.js` (1,727 lines), a `window.__ModuleLoader__.load` factory using `react.createElement`.

**How tools are registered today.** `connect()` (`lib/index.js:3404`) opens a transport, keeps the raw `tools/list` array on the handle, and calls `registerToolsGlobal` (`:2863`) for the global tier or the per-agent sync (`:3781`) for a workspace tier. Both go through `makeToolDefinition` (`:2713`), which needs a live `tools/list` entry for the description and input schema. On failure `connect()` disposes every registration, zeroes `toolCount`, clears the server's global names, and marks the connection `needs-auth` or `error` (`:3449`-`:3467`). No catalog survives the failure, and nothing else can build a definition.

**How authorization works today.** A rejected `tools/call` enters `withAuthRecovery` (`lib/auth/recovery.js:105`), which blocks on `createAuthGate` (`lib/auth/gate.js:66`), publishes the wait through `GET /attention`, renders the conversation banner, and retries once after `authGate.authenticated()`. The model-facing text is built only by `authFailureMessage` (`recovery.js:67`). The path requires a registered tool to call — exactly what a `needs-auth` server does not have.

**OAuth start.** `POST /servers/:id/auth` creates a session, acquires a loopback listener, and returns the authorization URL; the client opens it with `window.open`. The host has no public "open a URL" service: the `openBrowser` used by `dsh web --open` is private to `packages/bundle/web-app`.

**Host APIs available to this plugin.** `ctx.tools` (register, guard, restrict, schemas, get, execute), `ctx.systemPrompt` (section, context), `ctx.agents` (get by session id), `ctx.webServer`. The plugin injects only `['tools']` and reaches every other service defensively through `ctxGet()` (`lib/index.js:832`), so an optional service must stay optional.

**Prompt-cache constraint.** `registrationSignature` (`lib/index.js:2736`) covers name, description, parameters and the deferral marker. A registration whose signature changes is disposed and re-registered, which changes the prompt prefix for that session.

**Project rules** (`AGENTS.md`): plain JavaScript, `ctx.logger` with the `mcp-manager:` prefix, state writes under one lock with field merging, no secret ever logged, README in sync with behavior.

## Goals / Non-Goals

**Goals:**
- Expose a server's last known catalog while it needs authentication, at both tiers, obeying the same broker deferral as live tools.
- Keep one registration path: live and cached definitions are produced by the same builder and synchronized by the same function.
- Give the model a first-class authorization request and a one-shot notice when authorization completes.
- Shrink the host file by extracting the registration block, and keep the new behavior in pure modules with injected ports.
- Remove the second interface language and the localized README.

**Non-Goals:**
- Making a cached call wait for authorization, or publishing attention entries for it.
- Operator-authored tool declarations, catalog TTLs, or background catalog refresh.
- Cached definitions for `disabled`, `error`, `connecting`, `configured`-but-not-loaded, or `conflict` servers.
- Changes to the banner, the `/attention` listing, the OAuth callback surface, redirect resolution, JSON import, or the on-demand broker contract.

## Decisions

### D1. The catalog lives in a sidecar file

A dedicated `~/.dsh/mcp-manager-tools.json` stores `{ version: 1, servers: { "<serverKey>": { name, listedAt, tools } } }`, keyed by the existing `serverKey()` (`lib/auth/gate.js:52`) so a workspace server survives the `ws-*` id regeneration that `normalizeWorkspaceServer` performs on every load.

*Why not the state file:* that file carries tokens, every write takes the refresh lock, and a catalog write on each successful listing would contend with OAuth refreshes for no reason. The sidecar is non-sensitive and disposable.

*Shape and bounds:* entries are normalized to `{ name, description, inputSchema }` only; a per-server cap (200 entries, 128 KiB serialized) keeps a hostile or enormous server from bloating the file. An unreadable or corrupt file reads as empty, is logged once, and is rewritten on the next success.

*Concurrency:* writes are read-modify-write of a single server key, under the sidecar's own lock file using the existing `tryStateLock` pattern (`lib/index.js:184`), so two profiles cannot drop each other's entries and the credential lock stays untouched.

### D2. One registration path for live and cached tools

`makeToolDefinition` already accepts any `tools/list`-shaped entry, so a cached entry needs no second builder. The definition's `execute` resolves the connection **at attempt time**:

- a live connection that exposes the name → dispatch the call;
- no live connection → throw `AuthRequiredError`, which the call path turns into the actionable error (D3).

Because resolution is dynamic, there is no "cached definition" type to reconcile: a server has one registration map, and a sync with a different input list replaces entries whose signature changed. This removes the failure in which a surviving registration holds a stale call function.

### D3. A call without a live connection fails fast

The error is built next to `authFailureMessage` (the single home of model-facing auth text) with a new outcome that names the server, states the call was not executed, and instructs the caller to call `mcp_authenticate_server("<server>")`. The call path does not enter `withAuthRecovery`, publishes no attention entry, and performs no retry.

*Why not reuse the gate:* the gate exists to keep a caller attached to a live transport while a human authorizes. Here nothing is attached, and the accepted behavior is a fast, instructive failure that returns the turn to the model.

### D4. `mcp_authenticate_server` is an ordinary plugin tool

The name does not start with `mcp__`, so `isMcpToolName`, `brokerCatalog` and the direct-call guard ignore it: it is never deferred and stays callable with the broker enabled.

*Registration policy:* reconciled against the set of browser-authorizable servers (global plus any workspace) — registered when the set is non-empty, disposed when it becomes empty. No per-server variants.

*Scope resolution:* the tool resolves the caller's agent through `exec.agent` and looks the name up in the global servers plus that agent's workspace servers; a name outside that scope fails as not configured.

*Start flow:* the route handler's authorization start is extracted into one function that both `POST /servers/:id/auth` and the tool call, so there is a single implementation of "start OAuth for this server". A pending session for that server returns its URL instead of starting a second flow.

*Browser launch:* `lib/browser/open-url.js` maps the platform (`open`, `cmd /c start`, `xdg-open`), injects `spawn`, is skipped when `SSH_CONNECTION` or `SSH_TTY` is set (the same rule `dsh web` uses), treats a launcher failure as non-fatal, and never receives a URL the plugin did not create.

### D5. The announcement is dynamic model context, read once

A provider registered through `ctx.systemPrompt.context()` returns the notice text only while a notice is queued, and clears it when it is read, so it appears in exactly one assembly. It is emitted only when a `connect()` that follows an authorization attempt succeeds.

*Why not `agent.inbox`:* it creates a turn — spending tokens and pre-empting the operator — and lands in the chat history.
*Why not a system-prompt section:* sections are the cached, stable part of the prompt; a per-turn fact belongs to context. The cost is one assembly with one extra context line.

The provider is optional: when `ctx.systemPrompt` is absent the notice is dropped and logging records it once.

### D6. The inventory endpoint and the card report the cache as stale

`GET /servers/:id/tools` answers `200 { tools, stale: true }` for a `needs-auth` server with a catalog, `409` for a `needs-auth` server without one, and keeps `409`/`404` for every other disconnected state and unknown id. The card reuses the same fetch path and renders a stale badge; the empty-state messages stay for the no-catalog case.

### D7. Registration extraction

`lib/tools/registration.js` receives `makeToolDefinition`, `registrationSignature`, `disposeRegistrations`, the deferral retag helpers, `syncToolRegistrations`, and the global/workspace sync wrappers, behind a factory taking its collaborators (tool registry access, logger, name mapping, parameter conversion, image projection, concurrency predicate, deferral decision). `lib/index.js` keeps the wiring and the lifecycles it already owns.

*Why now:* the cached path needs the same three call sites, and duplicating them in the host file would grow it further. The extraction is behavior-preserving and lands before the cached path, so the regression surface is covered by the existing suites.

### D8. English-only interface and documentation

`lib/client.js` loses the Chinese dictionary and the language resolution; `t()` collapses to the English string. `README.zh-CN.md` is deleted, removed from `package.json`'s `files`, from the shipped README's links and from `AGENTS.md`. The two bilingual obligations embedded in existing requirements are replaced by the single `plugin-language` capability.

### D9. Release

Version 0.22.0 (behavior addition plus a breaking interface change), with `docs/release-v0.22.0.md` covering the sidecar file, the new tool, the stale inventory, and the language removal.

## Risks / Trade-offs

- **A stale catalog misleads the model** → the fail-fast error names the server and the tool to call; the card marks the names stale; the catalog is replaced on the next successful listing.
- **Prompt-cache churn when cached definitions become live** → both carry the server's own description and parameters, so the signature can be preserved; the announcement costs one assembly.
- **Two processes writing the sidecar** → read-modify-write of one key under the sidecar's own lock; last writer wins per server, and no entry is dropped.
- **A corrupt sidecar blocks nothing** → read as empty, logged once, rewritten on the next success; a write failure never fails a connect.
- **Model-initiated browser launch is a side effect** → only configured servers, only the plugin's own authorization URL, no launch over SSH, and the URL is always returned to the caller.
- **Removing the Chinese dictionary leaves dangling references** → the removal task includes a repository-wide search and the client harness update, and fails the suite if a key is still resolved.
- **Extraction churn in a 4,900-line file** → the extraction is a pure move with the suite as the gate, completed before any new behavior depends on it.

## Migration Plan

- No data migration: the sidecar is created on the first successful listing; its absence means no cached tools, which is today's behavior. Deleting it is always safe.
- No persisted setting changes, so a rollback is "install the previous version": cached tools disappear and the two new behaviors stop, with all server configuration and tokens intact.
- The English-only interface is not reversible at runtime; rolling back restores the previous bilingual client with the previous release.

## Open Questions

- None that change the specs, the approach, or the task breakdown. The per-server cap (200 entries / 128 KiB) and the notice wording are implementation defaults recorded in D1 and D5.
