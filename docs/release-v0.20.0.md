# v0.20.0: configure and edit MCP servers from JSON

Related board task: *Configurar e adicionar MCP servers via JSON* (Open Spec v1).
OpenSpec change: `import-mcp-servers-from-json`.

Configuring a server meant filling a long form one server at a time. An operator
who already had a `mcpServers` document — a teammate's workspace `mcp.json`, a
Claude/Codex snippet, a previous profile — had no way to paste it: the only
alternatives were retyping every field or hand-editing
`~/.dsh/mcp-manager.json` and `<workspace>/.dsh/dshmm/mcp.json` with no
validation, no diff and no merge safety.

This release adds a JSON entry point with a preview, shared by both scopes.

## Changes

- **Entry points.** The actions next to the add button become a `⋯` menu holding
  **Edit JSON** and **Import JSON**, and every expandable server card gains
  **Edit as JSON**. The dialog shows the document beside the preview, starts on
  the scope the page is showing, and locks the scope and the name when it is
  opened from a card.
- **One accepted document.** `{ "mcpServers": { "<name>": { … } } }` using the
  field names the workspace declaration already uses — the same object is valid
  in either scope and can be pasted from a `mcp.json` as-is.
- **Transport inference in the import path only.** An entry without `type` that
  carries a `command` and no `url` is a stdio server; `type: "sse"` is read as
  HTTP and the preview says so. Reading an existing workspace file keeps its
  strict rule.
- **Two modes, deliberately asymmetric.** **Import JSON** creates and updates and
  never deletes. **Edit JSON** treats the document as the complete scope: it
  creates, updates and deletes, listing every deletion and asking for
  confirmation before applying.
- **A preview before anything is written.** Each entry is classified `new`,
  `update`, `unchanged`, `conflict`, `invalid`, or (edit mode) `delete`, with the
  changed fields and their before/after values. A name used in the other scope is
  a `conflict` resolved per entry as **keep** (skip it) or **replace** (move it
  into the target scope).
- **Atomic batches.** The whole document is validated before a file is touched;
  an invalid entry aborts the batch with its name and field, and nothing is
  written.
- **Merge rules.** Structural fields come from the entry (omitting `headers`
  clears them), an omitted OAuth credential field and an empty `tokenEnv` inherit
  the stored value, an explicit empty string clears an OAuth field, keys the
  schema does not define are discarded — including `oauth`, `tokens` and
  `staticToken`, so a document can never introduce a token — and unknown keys at
  the top of a workspace file survive.
- **OAuth state survives.** A stored registration and its tokens are kept while
  the client identity and the issuer do not change, and move with the server when
  a `replace` changes its scope (in either direction). A changed identity — including
  an explicitly cleared `clientId` or `clientName` — drops them, and the next
  authentication re-registers.
- **No hidden state changes.** The import never enables or disables a server,
  never starts an authorization, and never disconnects one whose configuration
  did not change. A disabled server stays disabled and does not connect.
- **One validated plan.** `POST /mcp-manager/api/import` serves the preview
  (`dryRun: true`) and the application from the same validator; an application
  re-validates the submitted document instead of trusting a cached plan, and the
  dialog discards its preview as soon as the target scope changes. A batch is
  limited to 200 entries and 1 MiB.
- **Refactoring carried by the change.** The pure configuration helpers moved out
  of `lib/index.js` into `lib/servers/config.js`; the four write paths now share
  one `buildServerEntry`; the OAuth identity tuple is one `sameAuthIdentity`
  predicate used by both editors and the importer.

## Compatibility

- `~/.dsh/mcp-manager.json` and `<workspace>/.dsh/dshmm/mcp.json` keep their
  formats; no migration is required.
- One deliberate behaviour alignment: an empty `tokenEnv` now inherits the stored
  environment-variable name in the workspace editor, as the profile editor
  already did, and the workspace edit path now compares the endpoint origin when
  deciding whether a stored session survives.
- Servers created or edited through JSON are ordinary entries, so downgrading
  keeps them working; servers deleted by an Edit JSON batch stay deleted.

## Verification

`npm test` covers the document parser and planner (`test/import-format.test.js`),
the shared helpers (`test/servers-config.test.js`), the application ports
(`test/import-apply.test.js`), the API contract (`test/import-api.test.js`) and
the client menu, dialog and card action (`test/client-json.test.js`), including
both interface languages.

Live check: install into a scratch profile, open Settings → MCP, paste a
multi-server document, preview it, apply it, and confirm a second identical paste
classifies every entry as unchanged.
