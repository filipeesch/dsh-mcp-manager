# Proposal

## Why

The MCP authentication surfaces report the wrong thing in four ways. The conversation banner is
visually foreign to the composer and takes the whole column. A tool call rejected because the MCP
transport session expired surfaces as a bare `404` the model cannot act on, and the connection stays
marked connected, so every later call fails the same way. Settings → MCP paints provider error text in
red and offers no way to reauthenticate a server that looks connected. And an authorization that is
pending in one conversation is invisible from every other conversation and screen, so the operator
only learns about it when the wait expires and the call fails.

All four are one problem: the plugin knows a call is blocked on a human, but it neither repairs what it
can repair on its own nor tells the human in the place where they can act.

## What Changes

- A dead MCP transport session is repaired inside the transport: a call rejected because the server no
  longer knows the session is retried once against a freshly initialized connection, before any error
  reaches the model. Only a second failure surfaces.
- The conversation banner becomes a compact card on the composer's own width, radius and surface, with
  at most three server rows visible and the remainder folded behind an expandable summary.
- The server card reports authentication through one status control that is itself the authentication
  action, offers a reauthenticate action on every OAuth server regardless of its current status, keeps
  provider error text out of the card (the attempt log owns it), and states an insufficient-scope
  requirement as its own neutral line instead of a red failure.
- A frame-wide authentication alert notifies the operator about a wait owned by a conversation that is
  not visible, including while Settings is open. Each alert names the server and the owning
  conversation and offers `Go to conversation` and `Authenticate`; authenticating from it does not
  navigate away.
- The HTTP transport leaves `lib/index.js` for its own module behind injected ports, and one shared
  authorization action replaces the per-surface copies the card, the banner and the new alert would
  otherwise each carry.

No stored data changes: no new state-file key, no token-shape change, no catalog version.

## Capabilities

### New Capabilities

- `mcp-transport-session`: how a transport session that the server no longer recognizes is detected
  and repaired by reconnecting and retrying once, and what the caller observes when the repair fails.
- `mcp-auth-alerting`: the frame-wide alert that reports an authentication wait owned by a
  conversation the operator cannot see, and the actions it offers from outside that conversation.

### Modified Capabilities

- `mcp-chat-auth`: the banner's geometry changes from a full-width block to a compact card on the
  composer's width, and its rows fold behind a summary past a fixed visible count.
- `mcp-settings-ui`: the server card's authentication control, the reauthenticate action, the
  removal of provider error text from the card, and the neutral insufficient-scope line.

## Impact

- `lib/index.js` shrinks by roughly 600 lines: the Streamable HTTP, HTTP-with-SSE and stdio transports
  move to a transport module with injected ports (token access and refresh, status classification,
  attempt log, retained catalog, logger).
- New `lib/transport/*` module; `lib/auth/gate.js` and `lib/auth/recovery.js` keep their contracts.
- `lib/client.js` gains the compact banner, the frame-wide alert, and one shared authorization action
  used by the card, the banner and the alert.
- New client surface: `shell.overlay` entry. The toast reads the open conversation from the
  application's persisted selection, because `shell.overlay` is root-scoped and receives no session
  identity.
- Tests: `test/client-chat-auth.test.js` changes with the banner format; new coverage for dead-session
  recovery, the alert, and the card's authentication control.
- Version: 0.23.0.
