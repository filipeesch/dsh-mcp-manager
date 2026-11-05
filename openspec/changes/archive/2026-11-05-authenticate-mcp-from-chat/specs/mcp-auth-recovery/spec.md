# Spec Delta

## Purpose

Defines how an MCP tool call that cannot authenticate recovers: it waits for a human reauthorization inside a bounded budget, resumes when the connection returns, and otherwise fails with an actionable error, while exposing the waiting calls to the conversation.

## ADDED Requirements

### Requirement: A rejected tool call waits for reauthorization

An MCP `tools/call` that the resource server rejects with an authentication failure, and whose connection cannot repair the failure by refreshing its token, SHALL begin an authentication wait instead of failing the call. The authentication failures that start a wait are an HTTP `401` on the call and an HTTP `403` carrying an explicit insufficient-scope challenge.

While the wait lasts the connection SHALL be reported as `needs-auth`. The wait SHALL be bounded to 120 seconds from the moment the failure is observed. The bound SHALL be configurable, and a configured value SHALL replace the default for every wait.

Only `tools/call` SHALL wait. An initialization, a tool discovery, or a connection attempt that fails authentication MUST NOT create a wait, because no call exists to resume.

#### Scenario: A rejected call waits

- **WHEN** a `tools/call` receives `401` and the token refresh does not repair it
- **THEN** the call remains pending, the server is reported as needing authentication, and the call is neither failed nor returned

#### Scenario: An insufficient scope waits

- **WHEN** a `tools/call` receives `403` with an explicit insufficient-scope challenge
- **THEN** the call waits like a `401` failure, and the reported reason states that a broader scope is required

#### Scenario: A refresh repairs the failure

- **WHEN** the rejection is repaired by a successful token refresh
- **THEN** the call is retried once without any wait and returns its normal result

#### Scenario: A connection failure does not wait

- **WHEN** a server fails authentication while connecting and no tool call exists
- **THEN** no wait is created, no attention entry is published, and the connection is reported as needing authentication

#### Scenario: A configured budget replaces the default

- **WHEN** the operator configures a different wait budget and a call starts waiting
- **THEN** the call settles at the configured budget instead of 120 seconds

### Requirement: Servers without a browser flow fail immediately

A server whose authentication mode provides no browser authorization flow, such as a static bearer token read from an environment variable, MUST NOT create a wait. An authentication failure on such a server SHALL fail the call immediately with the actionable error.

#### Scenario: Static token rejected

- **WHEN** a call to a static-token server is rejected with `401`
- **THEN** the call fails immediately with the actionable error and no attention entry is published

### Requirement: A completed authorization resumes the waiting call

When an authorization for a server completes and the server reconnects, every waiting call of that server SHALL return to execution and be retried exactly once with the same tool name and the same arguments, regardless of which surface started the authorization.

A successful retry SHALL be returned as an ordinary tool result. A retry that fails again with an authentication failure MUST NOT start a second wait and SHALL fail with the actionable error. A retry that fails for a non-authentication reason SHALL return that failure unchanged.

#### Scenario: The call resumes and succeeds

- **WHEN** the operator completes the authorization while a call is waiting
- **THEN** the connection reconnects and the call is retried once against that new connection, returning the server's result

#### Scenario: The retry fails again

- **WHEN** the retried call is rejected again with an authentication failure
- **THEN** no second wait starts and the call fails with the actionable error

#### Scenario: One authorization resumes every session

- **WHEN** two sessions have waiting calls on the same server and either session completes the authorization
- **THEN** the waiting calls of both sessions resume and are retried

### Requirement: The wait ends with an actionable error

A wait that ends without a successful retry — because the budget expired, the call was cancelled, the server was disabled or removed, or the retry was rejected again — SHALL fail the call with an error that names the server, states that the call was not executed, and tells the caller that reauthorization is available from the conversation and from Settings → MCP. The turn SHALL continue after the error.

A failed authorization attempt MUST NOT end the wait: it SHALL be reported to the conversation and the call SHALL keep waiting until it resumes, is cancelled or reaches the budget.

The error text MUST NOT contain an access token, a refresh token, a client secret, an authorization code, a PKCE value or the authorization URL.

#### Scenario: The budget expires

- **WHEN** 120 seconds pass without a completed authorization
- **THEN** the call fails with the actionable error and the turn continues

#### Scenario: The provider rejects the authorization

- **WHEN** the authorization server returns an error instead of a code
- **THEN** the failure is reported to the conversation, the call keeps waiting, and it ends by a later successful authorization, a cancellation or the budget

#### Scenario: The server is disabled while a call waits

- **WHEN** the server is disabled or removed while a call is waiting
- **THEN** the wait settles with the actionable error and no retry is attempted

#### Scenario: No secret in the error

- **WHEN** any wait ends with the actionable error
- **THEN** the text contains no token, secret, authorization code, PKCE value or authorization URL

### Requirement: Cancelling a wait

The host SHALL expose an operation that cancels the waiting calls of one session and one server. It SHALL settle those calls with the actionable error, leave waiting calls of other sessions and other servers untouched, leave the stored configuration and tokens unchanged, and release a pending authorization flow for that server.

#### Scenario: Cancelling one session

- **WHEN** two sessions have waiting calls on the same server and one session cancels
- **THEN** only that session's calls settle with the actionable error and the other session keeps waiting

#### Scenario: Cancelling while the browser is open

- **WHEN** a session cancels while an authorization started from the conversation is pending
- **THEN** the waiting call settles and the pending authorization flow is released

#### Scenario: Cancelling a server with no waiting call

- **WHEN** the cancel operation names a server with no waiting call
- **THEN** nothing changes

### Requirement: Attention listing

The host SHALL expose a read-only listing of every server that has at least one waiting call. Each entry SHALL identify the owning session, the scope (`global` or workspace), the server id and name, the reason the call is waiting, the phase (`needs-auth` when no authorization is running and `authorizing` when one is), the number of waiting calls, and the deadline.

A connection that needs authentication without a waiting call MUST NOT appear. The listing MUST NOT contain a token, a client secret or an authorization URL, and reading it MUST NOT start a listener, record an attempt or change any state.

#### Scenario: A waiting call is listed

- **WHEN** a call is waiting for authentication
- **THEN** the listing contains one entry for that server with the owning session, the reason, the failure text of the last authorization attempt when one failed, the phase, the call count and the time remaining

#### Scenario: Authentication required without a call

- **WHEN** a server is in `needs-auth` because its connection failed and no call is waiting
- **THEN** the listing contains no entry for that server

#### Scenario: The listing leaks nothing

- **WHEN** the listing is read during any phase
- **THEN** it contains no token, client secret or authorization URL

### Requirement: Waiting calls carry their server and scope

A waiting call SHALL be attributed to the server and scope that served it, and an entry for a workspace server SHALL carry the workspace path so the conversation can attribute it correctly.

#### Scenario: A workspace call carries its workspace

- **WHEN** a server declared in the workspace's `mcp.json` has a waiting call
- **THEN** its listing entry reports the `workspace` scope and the workspace path, while a global server's entry reports the `global` scope

#### Scenario: Cancelling one server leaves another waiting

- **WHEN** two different servers each have waiting calls and the operator cancels one of them
- **THEN** the other server's entry keeps waiting

### Requirement: Aborting the turn settles the wait

Aborting the turn that owns a waiting call SHALL settle the wait immediately without retrying the call, SHALL release the pending authorization flow started for that wait, and MUST NOT leave a waiting entry behind.

#### Scenario: The operator stops the turn

- **WHEN** the operator aborts the turn while a call is waiting
- **THEN** the call settles as interrupted, no retry is attempted, and the pending authorization flow is released
