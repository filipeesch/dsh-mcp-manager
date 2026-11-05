# Proposal

## Why

When an OAuth MCP server stops accepting its access token in the middle of a conversation, the tool call ends as an opaque transport error (`MCP tools/call HTTP 401: invalid_token`) and the turn goes on without the data. The call path never moves the connection to `needs-auth`, so no surface can offer a way out: the operator has to leave the conversation, open Settings → MCP, reauthenticate and ask again. This is not hypothetical — in a BSP exploration session the `database` MCP rejected an expired token and the agent finished the turn saying it could not inspect the schema.

The plugin already owns everything the recovery needs (discovery, dynamic registration, PKCE, the loopback callback, token persistence and reconnect). What it lacks is the decision to wait for a human and the surface inside the conversation that lets the human act.

## What Changes

- **A tool call waits instead of failing**: an MCP `tools/call` that cannot authenticate no longer returns immediately. The host marks the connection `needs-auth`, records the waiting call, and holds it until a reauthorization completes or a two-minute budget expires; after a successful reauthorization it retries the same call once.
- **Authentication failure is recorded by every authenticated transport**: a `401` (and a `403 insufficient_scope`) that a refresh cannot repair moves the connection to `needs-auth` on the call path, for global and workspace servers alike, over Streamable HTTP and HTTP-with-SSE.
- **A call-scoped attention API**: `GET /mcp-manager/api/attention` lists the calls currently waiting (owning session, server scope and name, reason, phase, deadline) and `POST /mcp-manager/api/attention/cancel` releases the waiting calls of one session and server. The API carries no token and no authorization URL.
- **An in-conversation banner**: full-width above the composer, one row per server with a waiting call, showing the server, the reason, the number of waiting calls and a countdown, with **Authenticate** and **Cancel** actions. It renders only in the session that owns the call, for global servers and for that session's workspace, and disappears the moment the call resumes, is cancelled or times out.
- The Authenticate action reuses the existing start-authorization endpoints and opens the system browser; callback listeners, redirect resolution, PKCE, dynamic registration, token exchange and reconnect are unchanged.
- **An actionable failure**: timeout, cancellation, a server disabled or removed while waiting, or a failed retry end the call with an error that names the server, says the call was not executed, and points at the chat banner and Settings → MCP. A failed authorization attempt does not end the wait: the banner shows the failure and lets the operator try again until the budget expires. The model then chooses another approach instead of retrying blindly.
- Servers without a browser flow (`static`, `stdio`) never block and never appear in the banner; a failure that only happens while connecting (no call waiting) never appears either.
- Refactors this change needs, with no behavior change of their own: one start-authentication helper shared by the two settings rows and the banner, one failure-recording path used by every transport, a retry that resolves the live connection instead of the one captured at registration, and a client test harness that can record more than one slot registration.
- Ships as release 0.21.0 with `README.md`, `README.zh-CN.md` and `AGENTS.md` in sync.

## Capabilities

### New Capabilities

- `mcp-auth-recovery`: hosting a tool call that cannot authenticate — classifying the failure, moving the connection to `needs-auth`, blocking the call, waiting for a reauthorization within the budget, retrying once, cancelling, timing out, and the actionable error plus the attention API that exposes all of it.
- `mcp-chat-auth`: the conversation banner that lets the operator reauthorize a server without leaving the chat — where it renders, the row content, the `needs-auth`/`authorizing`/`error` states, the actions, which servers it lists, when it appears and disappears, and its localized copy.

### Modified Capabilities

- `oauth-callback`: the statement that starting an authorization remains a settings/workspace action no longer holds; the conversation banner is a second sanctioned trigger. Listener ownership, loopback binding, `state`-keyed routing, the ban on a web-interface callback route and the ten-minute session lifetime stay unchanged.

## Impact

- `lib/index.js` (host half): `makeToolDefinition.execute` and the per-tier `call` closures, `mcpRpc`, `sseSessionPost`, `openHttp`, `connect`, `registerToolsGlobal`, `registerWorkspaceTools`, `completeAuthorization`, `setServerAuthStatus`, `cancelSessionsFor`, `serverView`/`workspaceServerView`, and the `/mcp-manager/api/*` router.
- New host module `lib/auth/gate.js`: attention state, waiting calls keyed by server, the two-minute budget, cancellation, abort observation and reauthorization notification, with injected ports so it is testable without a plugin context.
- `lib/client.js`: the banner component registered into `conversation.input.dock`, its shared start-authentication helper, and new `mcp` locale keys in both `zh` and `en`.
- API: two endpoints under the existing `/mcp-manager/api/` prefix. No change to the state file, to stored tokens, or to the OAuth flow.
- Tests: a new host suite for the gate and the attention endpoints, an execution test for the blocked call (wait, retry, timeout, cancel, abort), and a client suite for the banner; `test/helpers/client-harness.js` learns to record several slot registrations; the existing API smoke, OAuth and client suites keep passing.
- Docs and release: `README.md`, `README.zh-CN.md`, `AGENTS.md`, `docs/release-v0.21.0.md`, `package.json` version 0.21.0.
- Unchanged: tool naming and registration, the on-demand broker, transports, discovery, registration, PKCE, scope selection, refresh, workspace isolation, imports and the Settings → MCP controls.
- No new dependencies; Node built-ins only.
