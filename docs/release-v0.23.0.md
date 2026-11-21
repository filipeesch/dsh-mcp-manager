# Release 0.23.0

A dead MCP transport session no longer reaches the model, the conversation banner
matches the composer, and a wait in another conversation is announced everywhere.

## What changed

### The transport repairs a dead session by itself

A server that restarted answers a request carrying an old `Mcp-Session-Id` with a
client error naming the session — the shapes measured in the wild are
`404 {"code":-32600,"message":"Session not found"}` and
`400 "Bad Request: Missing session ID"`. The plugin used to treat both as ordinary
failures: no reconnect, no retry, the connection stayed `connected`, and every
later call failed the same way.

Now the transport recognises that shape, rebuilds the connection (a new handshake,
a new tool listing, re-synchronised registrations) and replays the request once
with the same arguments. The caller sees the server's result. Only a second
failure surfaces. A repairable session is not an authentication wait: no alert,
no attention entry, and the connection stays connected.

Only a `404` or a `400` whose own words name a session counts. A `400` for an
invalid payload, an unknown tool, a `401` and a `403` keep their existing paths.
The replug is single-flight per server, so a burst of calls produces one
reconnect, not one per call. A replug rejected for authentication falls into the
existing `needs-auth` path.

### The conversation banner is a compact card

It now takes the composer's own geometry — width, corner radius, menu surface and
panel elevation — instead of spanning the conversation column with a tinted
border that clashed with the dark theme. At most three waiting servers are shown;
the rest fold behind a summary that states how many are hidden.

A row states the reason only when it is actionable (an insufficient scope or a
refused authorization). A provider that simply rejected a token says nothing an
operator can act on, and that wording stays in the attempt log.

### The card keeps diagnostics out of the way, and can reauthenticate

Provider error text no longer renders on the card, collapsed or expanded: the
attempt log is one click away on the same card and remains its only surface. The
insufficient-scope case keeps one neutral line naming the missing scope, because
the remedy differs from renewing a rejected credential.

`Reauthenticate` is now available for every OAuth HTTP server, whatever its
current status, so a credential can be renewed before it is rejected. The status
control still authenticates a server that needs it, and its label is unchanged.

### A wait in another conversation is announced

A new frame-wide alert on `shell.overlay` reports a wait owned by a conversation
the operator is not looking at — including while Settings is open over that
conversation. Each card names the server and the owning conversation and offers
`Go to conversation` and `Authenticate`; authenticating from the alert starts the
same flow and does not navigate away, so the waiting conversation resumes on its
own. The alert stays for as long as its wait exists, can be dismissed without
cancelling it, and returns for a later wait of the same server.

It reads the open conversation from the application's persisted selection, because
the overlay is root-scoped and receives no session identity. An unreadable
selection is treated as "no conversation visible", so the alert shows: an extra
alert is safer than a hidden one.

## Layout

- `lib/transport/http.js` — both HTTP transports, the dead-session predicate and
  the replay, behind injected ports.
- `lib/transport/protocol.js` — pure protocol and OAuth helpers (scope parsing,
  Bearer challenges, timeouts, the protocol-version notice).
- `lib/index.js` — the composition root: it wires the ports and owns state.

`lib/index.js` is ~600 lines smaller. The stdio transport and the OAuth core were
deliberately not moved: neither is affected by a transport session.

## Tests

New: `test/transport-port-contract.test.js` (the port contract, including that a
missing port fails and a supplied one works), `test/transport-dead-session.test.js`
(repair, replay, the tool list following the new session, a second failure, and
that no wait is created), `test/client-banner-compact.test.js` and
`test/client-auth-alert.test.js`.

`test/client-chat-auth.test.js` and `test/client-language.test.js` changed with the
new banner format and the removal of provider text from the card.

575 tests pass.

## Upgrading

No stored data changes: no new state key, no token-shape change, no catalog
version. Rollback is reinstalling the previous version.
