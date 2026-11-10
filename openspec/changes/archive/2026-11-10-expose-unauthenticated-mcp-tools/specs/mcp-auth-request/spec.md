# Spec Delta

## Purpose

Defines the model-facing tool that starts a browser authorization for one configured MCP server, the browser launch that follows it, and the notice the model receives once the server is usable again.

## ADDED Requirements

### Requirement: The authentication tool is available while a server can be authorized

The host SHALL register a tool named `mcp_authenticate_server` while at least one configured server — global or in a workspace — can be authorized through the browser. It MUST NOT be registered when no configured server offers that flow.

The tool SHALL remain directly callable while the on-demand MCP broker is enabled and MUST NOT be deferred by it.

#### Scenario: An OAuth server keeps the tool available

- **WHEN** at least one configured HTTP server uses OAuth
- **THEN** `mcp_authenticate_server` is registered

#### Scenario: No browser flow means no tool

- **WHEN** every configured server is stdio or uses a static token
- **THEN** `mcp_authenticate_server` is not registered

#### Scenario: The broker does not hide it

- **WHEN** the on-demand broker is enabled
- **THEN** `mcp_authenticate_server` is still callable directly

### Requirement: The call addresses one server in the caller's scope

The tool SHALL take one required argument naming a configured server. It SHALL resolve a global server, and a workspace server of the workspace that owns the calling conversation. A name that matches no server in that scope SHALL fail with an error that names the requested server and states that it is not configured in this scope.

#### Scenario: A global server is addressed

- **WHEN** the model names a configured global server
- **THEN** the call starts that server's authorization

#### Scenario: A workspace server is addressed

- **WHEN** the model names a server declared in the calling conversation's workspace
- **THEN** the call starts that server's authorization

#### Scenario: Another workspace is out of reach

- **WHEN** the model names a server that belongs to a different workspace
- **THEN** the call fails and no authorization starts

#### Scenario: Unknown name

- **WHEN** the model names a server that is not configured
- **THEN** the call fails naming the requested server and stating it is not configured in this scope

### Requirement: The call starts the existing authorization and returns immediately

The tool SHALL start the same authorization the Settings action starts and SHALL return without waiting for the callback, carrying the authorization URL and a short instruction to finish in the browser.

When an authorization for that server is already pending, the tool SHALL return the pending flow's URL instead of starting another one.

#### Scenario: The URL comes back at once

- **WHEN** the model calls the tool for a server with no pending authorization
- **THEN** the call returns the authorization URL and an instruction without waiting for the callback

#### Scenario: A pending flow is reused

- **WHEN** an authorization for that server is already pending
- **THEN** the call returns the pending URL and no second flow starts

### Requirement: The tool opens the system browser

On a local host the tool SHALL open the authorization URL in the default browser. When the host is reached over SSH it MUST NOT launch a browser. A failed launch MUST NOT fail the call, which still returns the URL.

#### Scenario: A local host opens the browser

- **WHEN** the tool runs on a local host
- **THEN** the authorization URL opens in the default browser

#### Scenario: An SSH host opens nothing

- **WHEN** the tool runs behind an SSH session
- **THEN** no browser is launched and the URL is still returned

#### Scenario: A failed launch still returns the URL

- **WHEN** the browser launcher fails
- **THEN** the call succeeds and returns the authorization URL

### Requirement: Servers without a browser flow are refused

A server that cannot be authorized through the browser — a stdio server, or an HTTP server using a static token or no authentication — SHALL be refused with an error that tells the operator to update the server's token or command in Settings → MCP. The refusal MUST NOT start a listener, a flow or a browser.

#### Scenario: A static-token server is refused

- **WHEN** the model names a server whose token comes from an environment variable
- **THEN** the call fails and instructs the operator to update the token in Settings → MCP

#### Scenario: A stdio server is refused

- **WHEN** the model names a stdio server
- **THEN** the call fails and no listener or flow starts

### Requirement: A completed authorization is announced to the model once

When an authorization completes and the server reconnects successfully, the host SHALL make one model-visible notice available naming the server and stating that its tools are available again. It SHALL be delivered as dynamic model context, not as system-prompt text, and MUST be emitted a single time rather than repeated on later turns.

When the authorization completes but the reconnect fails, no notice SHALL be emitted. The notice MUST NOT contain a token, a client secret, an authorization code or an authorization URL.

#### Scenario: The notice follows a successful reconnect

- **WHEN** the authorization completes and the server reconnects with its tools registered
- **THEN** the next model assembly carries one notice naming the server

#### Scenario: The notice does not repeat

- **WHEN** a later turn is assembled after the notice was delivered
- **THEN** the notice is no longer part of the model context

#### Scenario: A failed reconnect announces nothing

- **WHEN** the authorization completes but the server fails to reconnect
- **THEN** no notice is emitted

#### Scenario: No secret in the notice

- **WHEN** the notice is delivered
- **THEN** it contains no token, client secret, authorization code or authorization URL

### Requirement: The tool never changes configuration

The tool MUST NOT enable a disabled server, change its URL, its stored tokens, its scope or its headers, and MUST NOT accept an arbitrary URL to open.

#### Scenario: A disabled server stays disabled

- **WHEN** the model names a disabled server
- **THEN** the server stays disabled and its stored configuration is unchanged

#### Scenario: No arbitrary URL

- **WHEN** the tool is called
- **THEN** the only URL it can open is the authorization URL the plugin started for that server
