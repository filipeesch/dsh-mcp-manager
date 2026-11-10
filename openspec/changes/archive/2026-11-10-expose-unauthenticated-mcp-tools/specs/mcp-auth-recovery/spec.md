# Spec Delta

## ADDED Requirements

### Requirement: A call without a live connection fails immediately

A tool call whose server has no live connection SHALL fail immediately with the actionable authentication error. It MUST NOT start an authentication wait, MUST NOT publish an attention entry, and MUST NOT be retried.

The error SHALL name the server, state that the call was not executed, point the caller at the conversation and Settings → MCP, and name the tool that starts an authorization for that server. The text MUST NOT contain a token, a client secret, an authorization code, a PKCE value or an authorization URL.

#### Scenario: The call fails without waiting

- **WHEN** the model calls a tool whose server is not connected
- **THEN** the call fails at once and no wait is created

#### Scenario: The error names the authorization tool

- **WHEN** the call fails for a server that can be authorized through the browser
- **THEN** the error names `mcp_authenticate_server` together with that server's name

#### Scenario: A static-token server keeps its own message

- **WHEN** the call fails for a server whose authentication mode has no browser flow
- **THEN** the error asks the operator to update the token in Settings → MCP and names no authorization tool

#### Scenario: No secret in the error

- **WHEN** the call fails
- **THEN** the text contains no token, client secret, authorization code, PKCE value or authorization URL
