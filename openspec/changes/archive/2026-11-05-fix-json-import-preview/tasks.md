# Tasks

## 1. Preview follows the document

- [x] 1.1 Debounce a `dryRun` preview after the document or the target scope changes, keeping the manual Preview button; verify `test/client-json.test.js` schedules exactly one preview on mount and that running it issues one request.
- [x] 1.2 Discard a preview response that a newer request superseded (per-request token) and keep the debounce from starting while an application is in flight; verify the superseded-response test keeps the newer plan on screen.
- [x] 1.3 Show a plain apply label with no count while no plan exists, and report that the pane is previewing; verify the label and pane assertions in the invalidate-on-edit test.
- [x] 1.4 Preserve a `keep`/`replace` choice when the document is edited and clear it when the scope changes; verify the surviving-choice test and the scope-reset test.

## 2. Classification of derived defaults

- [x] 2.1 Report the workspace root in the import snapshot and compare the effective configuration on both sides so a derived stdio `cwd` is not a change; verify `classifies an untouched workspace seed as unchanged despite the derived cwd` in `test/import-api.test.js`.
- [x] 2.2 Make a projected workspace row report the same derived `cwd` a later rescan assigns; verify the same test reads the value from `GET /workspaces`.

## 3. Docs and release

- [x] 3.1 Describe the self-refreshing preview in `README.md` and `README.zh-CN.md`.
- [x] 3.2 Bump the version to 0.20.1 and add `docs/release-v0.20.1.md`.
