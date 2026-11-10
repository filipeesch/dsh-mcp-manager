# v0.22.2: every turn failed with "Cannot read properties of undefined (reading 'kind')"

Related board task: *exibir mcp tools mesmo que não autorizadas* (Open Spec v1).

Installing 0.22.0 or 0.22.1 could make **every prompt** fail with `This turn
failed: Cannot read properties of undefined (reading 'kind')` while the MCP page
and its servers kept working.

## Cause

`agent/pre-step` is a cordis **waterfall** event: listeners compose around the
driver's own decision and run outermost-first, and a listener that does not call
`next()` vetoes the rest of the chain. The 0.22.0 change registered a plain
observer — the listener that retires authorization notices — so the chain
returned `undefined`, and the agent loop then read `decision.kind` on it:

```ts
const decision = await this.dispatch.waterfall('agent/pre-step', payload, inner)
// decision === undefined → TypeError: Cannot read properties of undefined (reading 'kind')
```

Every turn that reached `pre-step` in an agent whose scope included the listener
failed before the model was called, which is why prompts failed while settings,
tools and MCP status stayed healthy. Long-lived sessions whose agent predates the
plugin kept working, which made the failure look intermittent.

## Changes

- The listener now calls `next()` and returns its result: it observes the step
  boundary without taking part in the decision.
- The test harness models the cordis waterfall contract instead of a plain emit,
  and the notice test asserts that the driver's decision survives the listener —
  this is the regression test that would have caught it.

## Verification

- `npm test` — 543 tests pass, including the waterfall-forwarding assertion.
- Reproduced the original error from a real session log
  (`turn/end` with `reason.kind === 'error'` and the same message) before the fix.

No data is affected: turns failed before any request, and the MCP state,
sessions and settings are untouched.
