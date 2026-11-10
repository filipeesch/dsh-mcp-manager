# v0.22.1: activation can no longer take the MCP page down

Related board task: *exibir mcp tools mesmo que não autorizadas* (Open Spec v1).

A profile could end up with the MCP tools still registered while `Settings → MCP`
showed no servers at all: the plugin host half was no longer serving its own
routes. Two gaps made that state possible and invisible.

## Changes

- **Registration cannot abort activation.** `mcp_authenticate_server` is
  registered through the same reconciliation used after every server change, and
  a failure there (a name another instance still owns, for example) is logged
  instead of thrown. Before, a throw during `apply()` aborted the rest of the
  plugin — including the code that mounts the Settings API — while the tools that
  had already been registered stayed visible.
- **The step listener is effect-scoped.** The `agent/pre-step` listener that
  retires authorization notices now lives in `ctx.effect`, so a plugin reload
  removes it instead of leaving a stale one behind.
- **A host read failure is reported.** When `GET /mcp-manager/api/servers`
  fails (a host half that is not loaded answers 404, a reload failure answers
  500), the page now says it could not read the servers and suggests reloading
  the page or restarting DSH, instead of rendering an empty catalog that looks
  like every server was deleted. The same message covers an unreachable host.

## Recovery for an affected profile

The state file is untouched by this bug. Restart DSH so the process loads the
plugin from the installed package again; `Settings → MCP` then lists the
servers as before.

## Verification

- `npm test` — the host and client suites, including the new host-failure case.
- `openspec validate --specs` — unchanged specs (this is a defect fix).
