# Spec Delta

## Purpose

Owns the local HTTP listeners that receive OAuth authorization codes and routes every callback to its originating authorization flow by the OAuth `state` parameter, independently of the DSH web interface.

## ADDED Requirements

### Requirement: Plugin-owned callback listener

The plugin SHALL receive OAuth callbacks on HTTP listener(s) that it opens itself, independently of the DSH web interface, and OAuth authorization MUST work in a profile that provides no web interface.

A listener MUST bind loopback interfaces only. It SHALL be started when an authorization flow needs it and MUST NOT be opened at plugin startup or only to display a redirect URI.

#### Scenario: Authorization works without the web interface

- **WHEN** a profile loads the plugin without a web interface and an OAuth server starts authorization
- **THEN** the authorization URL points at a loopback listener owned by the plugin and the flow completes

#### Scenario: No listener before authentication

- **WHEN** the plugin has loaded with OAuth servers that need authentication and no authorization has started
- **THEN** no callback port is bound

#### Scenario: Loopback-only binding

- **WHEN** a callback address resolves to anything other than a loopback interface
- **THEN** the listener is not opened and the attempt fails with an actionable message

### Requirement: Listener readiness before authorization

The plugin MUST NOT return an authorization URL until every listener the redirect URI requires is bound and accepting connections, and the port in the returned redirect URI MUST be the port the listener actually bound.

#### Scenario: Authorization URL implies a bound port

- **WHEN** authorization starts and the plugin returns the authorization URL
- **THEN** the redirect URI's port is already accepting connections

#### Scenario: Bind failure aborts the attempt

- **WHEN** the listener cannot bind, for example because the fixed port is occupied
- **THEN** no authorization URL is returned, the attempt fails with a message naming the address and the cause, and no other port is tried silently

### Requirement: Callback URL carries no MCP identifier

The callback path SHALL default to `/callback` and SHALL be configurable globally. The callback URL MUST NOT contain a server id, server name, workspace path or any other MCP identifier.

#### Scenario: Default path

- **WHEN** authorization starts for a server with no override and no configured path
- **THEN** the redirect URI ends with `/callback`

#### Scenario: Configured path

- **WHEN** the global callback path is `/oauth/return`
- **THEN** the redirect URI ends with `/oauth/return`

#### Scenario: No identifier in the URL

- **WHEN** any authorization starts
- **THEN** the redirect URI contains no value derived from the server's id, name or workspace

### Requirement: Callback routing by state

The plugin SHALL route a received callback to the pending authorization session whose OAuth `state` matches, and to no other session. A request for a path with no registered session SHALL be answered with a not-found response and MUST NOT start a token exchange.

#### Scenario: Two servers share one listener

- **WHEN** two MCP connections authorize through the same listener and both callbacks arrive
- **THEN** each callback completes only the flow that its `state` belongs to

#### Scenario: Different paths on one port

- **WHEN** two servers resolve to different callback paths on the same address and port
- **THEN** one listener serves both and each callback completes its own flow

#### Scenario: Unknown path

- **WHEN** a request arrives at a path with no pending session
- **THEN** the listener answers not-found and no token request is made

### Requirement: Authorization session content

Each authorization attempt SHALL be tracked by a unique, unpredictable `state` that is independent of server identifiers. The session SHALL retain the server and workspace identity, the OAuth client information, the resolved redirect URI, the PKCE verifier and challenge context, the state and its expiry, and the flow status.

#### Scenario: Session carries its own client context

- **WHEN** a callback completes a flow
- **THEN** the token exchange uses the client information, redirect URI and PKCE verifier stored in that session

#### Scenario: Session is not addressed by server id

- **WHEN** a callback arrives for a flow
- **THEN** the flow is located by its `state` alone

### Requirement: Single-use state with expiry

The plugin SHALL consume a `state` exactly once and SHALL expire a session ten minutes after it is created. An unknown, expired or already-consumed callback MUST be rejected with an explanation and MUST NOT perform a token request or modify stored tokens.

#### Scenario: Replayed callback

- **WHEN** a callback URL is opened a second time after its flow completed
- **THEN** the second request is rejected as expired or invalid and no token request is made

#### Scenario: Expired session

- **WHEN** a callback arrives more than ten minutes after its authorization started
- **THEN** the session is rejected as expired, the connection returns to needing authentication, and the listener is released when nothing else needs it

#### Scenario: Unknown state

- **WHEN** a callback carries a `state` that matches no pending session
- **THEN** the listener answers with an invalid-session page and performs no token request

### Requirement: Concurrent authorization flows

The plugin SHALL support authorization flows that are pending at the same time, both for different MCP connections and for the same MCP connection. Completing one flow MUST NOT invalidate another pending flow, and the most recent successful exchange SHALL determine the token pair stored for that connection.

#### Scenario: Two connections at once

- **WHEN** two MCP servers start authorization before either callback arrives
- **THEN** both sessions stay valid and both flows can complete

#### Scenario: Same connection twice

- **WHEN** two authorization flows for the same MCP connection are pending
- **THEN** each callback completes its own flow and the later successful exchange determines the stored token pair

#### Scenario: A sibling failure is isolated

- **WHEN** one of two pending flows fails
- **THEN** the other flow remains valid and can still complete

### Requirement: Isolation between MCP connections

A callback SHALL affect only the MCP connection that started its flow. The plugin MUST NOT write tokens, client registration or status belonging to one MCP connection onto another, and MUST NOT use one connection's client identity or PKCE context for another's exchange.

#### Scenario: No cross-connection token write

- **WHEN** a callback completes for one connection while another connection has stored tokens
- **THEN** the other connection's stored tokens are unchanged

#### Scenario: Identity stays with its connection

- **WHEN** two connections use different client registrations and redirect URIs
- **THEN** each exchange uses its own client identity and redirect URI

### Requirement: Listener sharing and release

The plugin SHALL reuse one listener for every pending flow whose address and port are compatible, and SHALL open additional listeners only when different fixed ports are required. A listener SHALL be stopped when no pending session requires it, and the plugin MUST NOT stop a listener while another pending session still requires it.

#### Scenario: Sharing an automatic listener

- **WHEN** two connections need a callback and the first has already opened an automatic listener
- **THEN** the second flow uses that listener instead of opening another port

#### Scenario: Releasing after the last flow

- **WHEN** the only pending flow on a listener completes, fails or expires
- **THEN** the listener is stopped and its port is free again

#### Scenario: Keeping the listener for another flow

- **WHEN** one of two pending flows on the same listener completes
- **THEN** the listener stays available for the other flow

#### Scenario: Distinct fixed ports

- **WHEN** two servers require different fixed callback ports
- **THEN** two listeners run at the same time, each serving its own flows

### Requirement: Shutdown and restart cleanup

Plugin unload and restart SHALL release every listener and discard every pending session, and MUST NOT leave a bound port behind. A restart MUST NOT require an operator action to clear stale callback state.

#### Scenario: Unload releases ports

- **WHEN** the plugin is unloaded while an authorization is pending
- **THEN** every listener is closed and the port can be bound again

#### Scenario: Restart has no pending state

- **WHEN** the plugin starts after a previous run left flows pending
- **THEN** no session is pending and no callback port is bound

### Requirement: Token refresh does not depend on a listener

Token refresh and token persistence MUST work with no callback listener running.

#### Scenario: Refresh after release

- **WHEN** stored tokens expire after every listener has been stopped
- **THEN** the refresh still succeeds without opening a callback listener

### Requirement: Callback diagnostics

The plugin SHALL report, in the attempt log of the affected connection and in the interface, actionable messages for listener startup failures, port conflicts, addresses that cannot be served, redirect URIs rejected by the authorization server, invalid, expired or duplicated states, token-exchange failures and authentication timeouts. The messages MUST NOT contain authorization codes, access tokens, refresh tokens, PKCE verifiers or OAuth states.

#### Scenario: Fixed port already occupied

- **WHEN** authentication starts and the fixed callback port is already in use
- **THEN** the message names the port and the reason, and no fallback port is selected

#### Scenario: No secrets in diagnostics

- **WHEN** any callback failure is recorded
- **THEN** the recorded text contains no authorization code, token, PKCE verifier or `state` value

#### Scenario: Duplicate callback is explained

- **WHEN** a callback is rejected because its flow already completed
- **THEN** the page explains that the authorization was already completed
