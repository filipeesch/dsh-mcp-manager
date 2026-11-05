# Proposal

## Why

Configuring an MCP server today means filling a long form one server at a time. An
operator who already has a `mcpServers` document — a teammate's workspace
`mcp.json`, a Claude/Codex snippet, a previous profile — has no way to paste it: the
only alternatives are retyping every field or hand-editing
`~/.dsh/mcp-manager.json` and `<workspace>/.dsh/dshmm/mcp.json` with no validation,
no diff, and no merge safety. The same gap shows up in the other direction: there is
no way to review a pending batch of servers, or to see what a paste would change,
before it lands.

## What Changes

- **JSON entry points on the Settings → MCP page.** The overflowing actions next to
  the add button become a `⋯` menu holding **Edit JSON** and **Import JSON**; the
  expandable server card gains an **Edit as JSON** action next to Edit.
- **One accepted document shape.** `{ "mcpServers": { "<name>": { … } } }` using the
  field names the workspace `mcp.json` already uses, so a file can be pasted as-is
  and the same object is valid in either scope.
- **Type inferred where the document is silent.** A pasted entry with no `type` and
  a `command` but no `url` is a stdio server; `type: "sse"` is treated as `http`.
  This inference applies to the import path only — the workspace config loader keeps
  its current strict rule, so existing files do not change meaning.
- **Two modes with an explicit asymmetry.** **Import JSON** is additive: it creates
  and updates, and an entry absent from the paste has no effect. **Edit JSON** is a
  declarative replacement of the selected scope: it creates, updates, and deletes
  the entries absent from the document.
- **A preview before anything is written.** Each entry is classified `new`,
  `update`, `unchanged`, `conflict`, `invalid`, or (Edit JSON only) `delete`, with the
  changed fields and their before/after values. A name occupied in the other scope is
  a `conflict` that the operator resolves per entry as `keep` (skip that entry) or
  `replace` (remove it from the other scope and create it in the target).
- **Atomic application.** The whole batch is validated before any file is touched; an
  invalid entry aborts the batch with a per-entry field and message, and nothing is
  written.
- **Merge rules that preserve what the document does not mention.** Structural fields
  are replaced from the entry, the OAuth credential fields inherit the stored value
  when omitted, an empty `tokenEnv` inherits too, unknown keys inside an entry are
  discarded, and unknown keys at the top of a workspace file survive.
- **OAuth state survives a re-import.** A stored token/client registration is kept
  when the client identity and issuer do not change, and is migrated across scopes
  when a `replace` moves a server whose identity matches. The import never touches
  the enabled/disabled state of a server.
- **Refactoring carried by the change.** The pure config helpers move out of
  `lib/index.js` into `lib/servers/config.js`; the four server-write paths collapse
  onto one builder; the OAuth identity tuple becomes one function used by every
  writer. This is what keeps the import from becoming a fifth parser.
- Ships as release **0.20.0** on top of `expose-mcp-tool-names` (0.19.0), with both
  READMEs, `AGENTS.md`, and a release note in sync.

Out of scope: importing credentials or sessions from other MCP clients, exporting a
scope as a downloadable artifact (the Edit JSON seed is a prefill, not an export
feature), and automatic synchronization with external configuration files.

## Capabilities

### New Capabilities

- `mcp-json-import`: the accepted `mcpServers` document, the two modes and their
  asymmetry, per-entry classification and conflict resolution, atomic validation and
  application, the merge and preservation rules, OAuth identity and token survival,
  the `POST /mcp-manager/api/import` contract including `dryRun`, and the dialog that
  presents the document and its preview.

### Modified Capabilities

- `mcp-settings-ui`: the card action row gains an **Edit as JSON** action, and the
  page's add/overflow actions move into a toolbar above the list with a `⋯` menu that
  opens the two JSON entry points. Requirement "Card action area fits the card" is
  amended; a requirement covering the toolbar menu is added.

## Impact

- `lib/servers/config.js` (new, pure): the extracted normalizers, the single server
  builder, `sameServerConfig`, and the OAuth identity predicate.
- `lib/import/format.js` (new, pure): document parsing, entry normalization, and plan
  classification.
- `lib/import/apply.js` (new): applying a validated plan through injected ports
  (workspace read/write, state save, connect) so it is testable without the plugin
  context.
- `lib/index.js`: the `/import` route, wiring the ports, and replacing the four
  write paths' inline validation with the shared builder.
- `lib/client.js`: the JSON dialog, the toolbar `⋯` menu, the card action, and new
  `mcp` locale keys in `zh` and `en`.
- Tests: new host coverage for parsing, classification, atomicity, both scopes, both
  modes, token survival, and migration; client coverage for the menu, the dialog, the
  preview, and locale parity.
- Docs and state: `README.md`, `README.zh-CN.md`, `AGENTS.md`,
  `docs/release-v0.20.0.md`. No new state-file key and no new dependency.
- Sequencing: the design assumes the 0.19.0 client shape (shared `serverCardView`,
  `.mm_toolbar`/`.mm_wsBar`, the primary add button). The three touch points are
  additive; any difference is reconciled when that change merges.
