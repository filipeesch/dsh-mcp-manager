# Spec Delta

## Purpose

Defines how a transport session that the MCP server no longer recognizes is repaired inside the transport, so a stale session never reaches the model as an opaque transport error.

## ADDED Requirements

### Requirement: A dead transport session is repaired before it reaches the caller

When a request is rejected because the server no longer recognizes the transport session, the host SHALL discard that session, establish a new one, and retry the request exactly once with the same method, name and arguments. The caller MUST NOT observe the first rejection.

The rejection SHALL be recognized as a dead session only when it is an HTTP 404 or 400 whose status or body names the session - a missing, unknown or expired session identifier. A 400 that does not mention the session, a payload error, an unknown tool, an authentication rejection and every other status MUST take their existing paths unchanged.

Rebuilding the session SHALL be a complete reconnect: a new initialization handshake, a new tool listing, and a refresh of the tools registered for that server, so a tool the server added or removed while the session was dead is reflected. The retried request SHALL run against the new connection.

#### Scenario: A stale session is repaired transparently

- **WHEN** a tool call is rejected with a status that names a session the server no longer knows
- **THEN** the host reconnects, repeats the call once, and returns the server's result, and the caller sees no error

#### Scenario: A missing session is repaired the same way

- **WHEN** a request is rejected because no session identifier was supplied but the server requires one
- **THEN** the host establishes the session and repeats the request once

#### Scenario: The tool list follows the new session

- **WHEN** a dead session is replaced and the server's tool set changed in the meantime
- **THEN** the tools registered for that server reflect the new listing, without a page reload or a model-visible failure

#### Scenario: An unrelated client error is not a dead session

- **WHEN** a request is rejected with a client error that does not name a session, such as an invalid payload or an unknown tool
- **THEN** the error returns to the caller unchanged and no reconnect happens

#### Scenario: A repairable session is not a wait

- **WHEN** a dead session is repaired by the reconnect
- **THEN** no authentication wait begins, no attention entry is published, and the server keeps its connected status

### Requirement: A session that cannot be repaired fails once

The reconnect-and-retry SHALL happen at most once per request. When the retried request is rejected again, the caller SHALL receive that failure. When the reconnect itself is rejected for authentication, the existing authentication handling SHALL apply, so a session that provably cannot be reestablished asks for a human instead of retrying forever.

#### Scenario: The repair fails twice

- **WHEN** the retried request is rejected again for a reason that would be repairable
- **THEN** the caller receives that failure and no further reconnect is attempted

#### Scenario: The reconnect needs a human

- **WHEN** establishing the new session is rejected with an authentication failure
- **THEN** the server is reported as needing authentication and the existing authorization path applies

### Requirement: One detection rule for every transport

Every HTTP transport the plugin speaks SHALL apply the same dead-session rule, including the Streamable HTTP path and the HTTP-with-SSE session path. The rule MUST be expressed once, so the two transports cannot disagree about what counts as a dead session.

#### Scenario: Both transports repair alike

- **WHEN** a server using either HTTP transport loses its session
- **THEN** both repair it by reconnecting and retrying once, with the same criteria for recognizing the failure
