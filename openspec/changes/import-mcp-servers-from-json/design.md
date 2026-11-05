# Design

## Context

See `proposal.md` — Why. The constraints that shape the approach:

- **Four write paths, one shape, four slightly different rules.** `POST /servers`,
  `PUT /servers/:id`, `POST /workspaces/servers` and `PUT /workspaces/servers` each
  build a server object inline or through `buildWorkspaceEntry`, and the workspace
  loader builds a fifth through `normalizeWorkspaceServer`. Defaults diverge: the
  global `PUT` keeps `tokenEnv` when the payload sends an empty string, the workspace
  builder clears it; the workspace loader swallows an invalid OAuth field while the
  editors reject it.
- **Two storage tiers.** Profile servers live in `state.servers` inside
  `~/.dsh/mcp-manager.json`; workspace servers live as `mcpServers[name]` entries in
  `<workspace>/.dsh/dshmm/mcp.json`, alongside `exclude`, `disabled`, and possibly
  keys this plugin does not know. Workspace OAuth sessions live in the state file
  under `workspaceTokens[<path>\n<name>]`, never in the declarative file.
- **Writes are merged and serialized.** `saveState` performs a three-way field merge
  against fresh disk state under the shared state lock, so a settings save never
  reverts a concurrent token rotation. Workspace writes are whole-file rewrites and
  are followed by a rescan; a file watcher rescans 300 ms after any change.
- **Pure helpers are trapped in a closure.** `parseOauthFields`, `buildWorkspaceEntry`,
  `sameServerConfig`, `parseArgs`, `parseEnv`, `applyTimeout` and `normalizeAuthMode`
  are defined inside `apply()` and are not exported, so a new module cannot reuse
  them without either a cycle through `lib/index.js` or a second parser.
- **Client shape assumed from 0.19.0.** `expose-mcp-tool-names` introduces a shared
  `serverCardView`, a `.mm_toolbar` (global) and `.mm_wsBar` (workspace) that already
  hold the add action, and a primary circular add button. This design attaches to
  those three points and does not restructure them.
- **Layout and language rules.** The plugin source layout is `lib/index.js`,
  `lib/client.js` and focused modules such as `lib/oauth/*`; changing it was
  explicitly requested for this change. The UI is bilingual with a shared key set,
  and every user-visible string goes through the `mcp` locale namespace.

## Goals / Non-Goals

**Goals:**

- One accepted document shape, one validator, one planner, and one application path
  for both scopes and both modes.
- A plan that is computable without touching disk and testable without the plugin
  context.
- Atomic batches with per-entry, per-field errors.
- Stored OAuth sessions survive anything that does not change the client identity or
  the issuer, including a move between scopes.
- No change to the enabled/disabled state, and no authorization started, by any
  import.

**Non-Goals:**

- Exporting a scope as a file or a download. The Edit JSON seed is a prefill; no
  route returns a document.
- Accepting aliases for fields the workspace format does not define (for example a
  Codex `http_headers`). Unknown keys are discarded, so such a paste loses those
  values by design.
- Changing the workspace loader's strictness, the add/edit form, or the tool-call
  timeout resolution.
- Deleting servers by absence in Import mode, or any implicit synchronization with
  external configuration files.

## Decisions

### D1 — The document is the workspace entry shape, in both scopes

The dialog accepts `{ "mcpServers": { "<name>": { … } } }` and reads the field names
the workspace declaration already uses. Profile and workspace imports share one
parser; only the target of the write differs.

*Alternatives considered:* a strict Claude/Codex subset (rejected: it cannot express
`authMode`, `tokenEnv`, `clientId`, `redirectUrl` or `timeout`, so the dialog could
not edit what the form edits); a separate versioned envelope with its own `$schema`
(rejected: two formats to evolve, and a pasted `mcp.json` would need conversion).

### D2 — Transport inference belongs to the import path only

An entry without `type` becomes stdio when it has a non-empty `command` and no
`url`; `sse` is read as `http` and the plan records a note. The inference lives in
the importer, not in `normalizeWorkspaceServer`, so a hand-written workspace file
that relies on `url` implying HTTP keeps its current meaning.

*Alternatives considered:* infer in both paths (rejected: silently reinterprets
existing files during a hot reload); require `type` for stdio (rejected: rejects a
real Claude/Codex paste, which is the feature's main input).

### D3 — Two modes, deliberately asymmetric

`mode: "import"` is additive: create and update, never delete. `mode: "edit"` is a
declarative replacement of the scope: create, update, delete. The mode is an explicit
request field, never inferred from the document, because the same document means
"add these" or "this scope is exactly this" depending on the entry point.

*Alternatives considered:* one mode that never deletes (rejected: an Edit JSON seed
that cannot remove a line is a trap); one declarative mode for both (rejected: a
partial paste would silently delete everything it did not mention).

### D4 — One endpoint with `dryRun`

`POST /mcp-manager/api/import` takes `{ scope, path?, mode, dryRun, mcpServers,
lockedName? }` and returns the plan. A preview is `dryRun: true`; the application
re-validates the submitted document from scratch and returns the classification it
applied. Preview and apply therefore share one code path, and no plan is cached
between them.

*Alternatives considered:* two endpoints (rejected: two routes to keep in sync);
a plan token returned by the preview (rejected: extra state and an expiry case, for a
race the re-validation already makes harmless).

### D5 — The plan is the contract

The response carries the whole decision, so the client renders and never classifies:

```
{
  "plan": {
    "scope": "global" | "workspace",
    "path": "…" | null,
    "mode": "import" | "edit",
    "entries": [
      { "name": "github",
        "action": "new" | "update" | "unchanged" | "conflict" | "invalid" | "delete",
        "changes": [{ "field": "url", "from": "…", "to": "…" }],
        "keepsSession": true,
        "staysDisabled": false,
        "conflict": { "scope": "global", "path": null, "enabled": true } | null,
        "resolution": "keep" | "replace" | null,
        "error": { "field": "url", "message": "url must be an http(s) URL" } | null,
        "notes": ["sse-read-as-http"] }
    ],
    "summary": { "new": 2, "update": 1, "unchanged": 1, "conflict": 1, "invalid": 0, "delete": 0 },
    "blocked": null | "invalid" | "conflict",
    "applyCount": 4
  },
  "applied": true | undefined
}
```

Status codes: `400` for a document that cannot be planned at all (not an object, no
`mcpServers`, duplicate names after trimming, over the size limit, `lockedName`
violated) and for an apply whose plan is blocked; `403` for a workspace that is not
registered or active; `200` otherwise, including a preview whose plan is blocked —
a blocked plan is data the dialog renders, not a transport failure.

### D6 — Validation produces structured errors

`parseOauthFields` and `buildServerEntry` attach `field` to the error they throw, and
`buildWorkspaceEntry` returns `{ error, field }`. Existing callers read `.message`
and are unaffected; the importer uses `field` for the per-entry report. No message
text is mapped back to a field.

*Alternatives considered:* a table of message-to-field heuristics (rejected:
fragile and duplicated); a second parser inside the importer (rejected: the exact
duplication the card forbids).

### D7 — One builder, one identity predicate

`lib/servers/config.js` exports the pure helpers, `buildServerEntry(input, current)`
(the single normalizer for every write path), `sameServerConfig`, and
`sameAuthIdentity(a, b)` = endpoint origin, `clientId`, `clientSecretEnv`,
`registrationNameKey`, `issuerOf`.

Unifying the builder settles the `tokenEnv` divergence in favour of *inherit when
empty*, and unifying the identity predicate adds the endpoint origin to the workspace
edit path, which today keeps a session across an origin change while the profile path
drops it. Both are intentional and pinned by tests.

*Alternatives considered:* export the helpers from `lib/index.js` (rejected: the
importer would import its own entry point, creating a cycle); copy the helpers
(rejected: divergence on the next bug fix).

### D8 — The planner is pure; the applier takes ports

`lib/import/format.js` does `parseDocument(text | object) → { entries, error }` and
`planImport(entries, snapshot, options) → plan`. `snapshot` is a plain value:
`{ scope, path, servers, workspaceRaw, workspaceTokens, enabledFor }`. No I/O.

`lib/import/apply.js` exports `applyPlan(plan, ports)`, where `ports` is
`{ readWorkspaceRaw, writeWorkspaceRaw, saveState, connect, disconnect, rescan,
cancelSessions }`. The plugin wires the real ports; tests pass fakes. The route
handler only parses the request, resolves the workspace, calls plan or apply, and
serializes the result.

### D9 — Merge and preservation rules

| Document field | Effect on an update |
| --- | --- |
| transport, `url`, `command`, `args`, `env`, `cwd`, `authMode`, `headers`, `headerEnv`, `timeout` | taken from the entry; omitted means reset to the builder's default, so omitting `headers` clears stored headers |
| `tokenEnv` (omitted or empty) | inherits the stored environment-variable name |
| `clientId`, `clientSecretEnv`, `clientName`, `scope`, `redirectUrl` (omitted) | inherit the stored value |
| the same fields with an explicit `""` | cleared |
| keys the schema does not define | discarded, including `oauth`, `tokens` and `staticToken` |
| unknown keys at the top of a workspace file | preserved |

Application differs per tier, matching today's writes: a profile row is patched in
place, so unknown keys on the stored row survive; a workspace entry is replaced
whole, so unknown keys inside the old entry do not.

### D10 — Session survival and migration

A profile server keeps `server.oauth`; a workspace server keeps
`state.workspaceTokens[<path>\n<name>]`. On update, the stored session is kept only
when `sameAuthIdentity` holds between the stored configuration and the new one; on a
`replace` that moves the server between scopes, the session object is copied to the
destination slot before the source slot is removed. The copy is a structured clone;
the secret is never read, logged, or serialized into a response.

### D11 — No hidden state changes

The importer never writes `enabled` and never touches the workspace `disabled` list
except when an edit deletes a name that no profile server owns (the same pruning the
delete action does). A disabled server is updated and left disabled; it is not
connected. A created server follows the form's rule: connect when it has what it
needs, otherwise record `needs-auth`. A changed server reconnects through the same
path an editor save uses.

### D12 — Two-file writes are ordered, not atomic

A batch writes in an order that never removes something whose replacement is not
durable yet: the target scope is written and the profile tier persisted first, then a
conflicting owner is evicted, then the workspace files are written and rescanned. If a
workspace write fails, the batch reports the failure and the orphaned token slots are
pruned by the next rescan, because a session is only read for a name the file declares.
A failure between the steps can leave two entries with the same name — a visible,
recoverable conflict — but it can never delete a server whose replacement was not
written. Nothing is written before validation passes.

### D13 — The dialog mirrors the plan

Two panels: the document (a text area with a JSON parse error surfaced inline) and
the preview. The preview renders one compact line per entry — classification, name,
and the changed field names — expanding to `from → to` values, with `invalid` and
undecided `conflict` entries expanded and blocking. The scope selector starts on the
page's current scope; the card entry locks both scope and name. The apply button
carries `applyCount` and is disabled while the plan is blocked. The modal widens past
the page's 760 px section; on a narrow viewport the preview moves below the document.

### D14 — Sequencing with 0.19.0

The client work attaches to `serverCardView` (a fourth action in the shared action
row), to `.mm_toolbar` and to `.mm_wsBar` (the `⋯` right after the add action). The
`mcp-settings-ui` delta adds requirements instead of rewriting the existing card
requirement, so archiving our delta cannot drop the 0.19.0 tool-list clause; any
textual overlap in `lib/client.js` is resolved at merge.

## Risks / Trade-offs

- **[A partial paste clears structural fields]** → The merge table is documented in
  both READMEs and the preview lists every cleared field as a change, so the
  operator sees `headers → removed` before applying.
- **[Unknown keys are discarded silently]** → It is the only rule that keeps a
  document from injecting `oauth` or `tokens`; the cost is that a Codex-style
  `http_headers` paste loses its headers. Documented as a known limitation.
- **[Delete-by-absence is destructive]** → It exists only in Edit mode, deletions are
  classified and counted in the preview, and the apply action requires confirmation;
  Import mode can never delete.
- **[A preview and an apply disagree]** → The apply re-validates from the submitted
  document and returns what it applied; the dialog refreshes its preview from that
  response.
- **[Two files, one batch]** → State is written before the workspace file, and an
  orphaned token slot is pruned by the next rescan; a failure is reported rather than
  rolled back.
- **[Unifying builders changes subtle behaviour]** → The `tokenEnv` rule and the
  endpoint-origin identity check are deliberate, covered by new tests, and the
  existing suites (`workspace-disable`, `workspace-reconnect`, `no-auth-mode`,
  `oauth-dcr-client-name`) must stay green.
- **[Merge overlap with `expose-mcp-tool-names`]** → Three additive touch points, an
  additive spec delta, and a note in the proposal's Impact section.
- **[Pasted secrets]** → Credential-shaped keys are dropped as unknown; `clientSecretEnv`
  is validated as an environment-variable name, so a literal secret in that field is
  rejected with a field-level message. The import never writes a token from the
  document.
- **[Large batch]** → 200 entries and 1 MiB, rejected before validation with a message
  stating the limit.

## Migration Plan

No state or file migration: the workspace declaration keeps its format, and the state
file gains no key. Release 0.20.0 on top of 0.19.0, with both READMEs, `AGENTS.md`
and `docs/release-v0.20.0.md`. Rollback is reinstalling the previous tag; servers
created or edited by the feature are ordinary entries, so they keep working, while
servers deleted by an Edit JSON batch stay deleted.

## Open Questions

- The exact viewport width at which the dialog switches from two panels to stacked
  can be settled during implementation without changing the specs or the tasks.
