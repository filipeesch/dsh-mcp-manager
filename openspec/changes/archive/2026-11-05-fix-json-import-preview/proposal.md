# Proposal

## Why

The JSON dialog computes its plan only when **Preview** is pressed. Editing the
document clears that plan, so the apply button falls back to `Apply 0` and stays
disabled — an operator who changes an existing server in the pasted JSON sees
"0 changes" and no way to apply it without discovering that Preview has to be
clicked again.

Investigating the same flow found a second defect. A workspace stdio declaration
has no `cwd` in the file (the loader defaults it to the workspace root), but the
dialog seeds itself from `GET /workspaces`, whose row carries that derived value.
Submitting the untouched seed classifies the entry as an `update` that adds
`cwd`, so applying it rewrites a line the operator never typed.

## What Changes

- The preview SHALL refresh automatically a short moment after the document or the
  target scope changes, using the same preview request the button issues. A
  response that a newer request superseded SHALL be ignored, and the refresh SHALL
  NOT race an application that is already in flight.
- While no current plan exists the apply action SHALL read as a plain apply
  without a count, never `Apply 0`, and the preview pane SHALL say it is
  previewing.
- Classification SHALL compare the configuration each side would run: a stdio
  entry without `cwd` and one whose `cwd` is the workspace root are the same
  server, so an untouched seed is `unchanged` and applying it writes nothing.
- Conflict choices SHALL survive an edit of the document (they are keyed by name
  and the host ignores names that no longer describe a conflict); changing the
  target scope still clears them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-json-import`: the preview refreshes itself while the document is edited, the
  apply action has an honest idle label, and classification compares effective
  configurations so a derived workspace default is not a change.

## Impact

- `lib/client.js`: a debounced preview effect, a per-request token so an older
  response cannot overwrite a newer plan, an idle apply label, and the conflict
  choices no longer cleared on edit.
- `lib/import/format.js`: classification compares the effective configuration when
  the target is a workspace.
- `lib/index.js`: the snapshot reports the workspace root, and a projected
  workspace row reports the same derived `cwd` a later rescan assigns.
- Docs and release: `README.md`, `README.zh-CN.md`, `docs/release-v0.20.1.md`,
  version 0.20.1.
- No state or file format change and no new dependency.
