# v0.20.1: the JSON preview follows the document

Related board task: *Configurar e adicionar MCP servers via JSON* (Open Spec v1).
Follow-up to the `import-mcp-servers-from-json` change.

## What was wrong

The dialog computed its plan only when **Preview** was pressed. Editing the
document cleared that plan, so the apply button fell back to `Apply 0` and stayed
disabled: an operator who changed a server in the pasted JSON saw "0 changes" and
no way to apply without discovering that Preview had to be clicked again.

Investigating the same flow surfaced a second defect. A workspace stdio
declaration has no `cwd` in the file — the loader defaults it to the workspace
root — but the client seeds the dialog from `GET /workspaces`, whose row carries
that derived value. Submitting the untouched seed therefore classified the entry
as an **update** that added `cwd`, and applying it rewrote a line the operator
never typed.

## Changes

- **The preview refreshes itself.** A short debounce after the document (or the
  target scope) changes runs the same `dryRun` request the Preview button issues,
  so the plan always matches the text on screen. A slower response for older text
  is discarded by a per-request token, and the debounce never races an Apply that
  is already in flight. The Preview button stays as a manual refresh.
- **The apply label is honest.** With no current plan the button reads `Apply`
  (`应用`) instead of `Apply 0`, and the preview pane says it is previewing.
- **Classification compares effective configurations.** A stdio entry with no
  `cwd` and one whose `cwd` is the workspace root are the same server, so an
  untouched seed is `unchanged` and applying it writes nothing.
- **Conflict choices survive an edit.** A `keep`/`replace` decision is kept while
  the document is edited (it is keyed by name, and the host ignores names that no
  longer describe a conflict); only changing the target scope clears it.
- The projected workspace row now reports the same derived `cwd` a later rescan
  assigns, whether or not the workspace is loaded.

## Verification

`node --test test/client-json.test.js test/import-api.test.js` covers the debounce
schedule, plan invalidation on edit, the superseded-response guard, the surviving
conflict choice, and an untouched workspace seed classifying as `unchanged`.
`npm test` passes in full.
