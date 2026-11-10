# mcp-unauthenticated-tools Specification

## Purpose
Defines the tool catalog the host retains for each MCP server and the definitions it exposes to the model while that server needs authentication, so a server the operator already used does not vanish from the model's view.

## Requirements

### Requirement: The host retains a catalog per server

The host SHALL retain, for each configured server, the raw `tools/list` entries of that server's last successful listing: the raw name, the description and the input schema. The catalog SHALL be persisted outside the credential state file, MUST NOT contain a token, a client secret, an authorization code or an authorization URL, and SHALL be safe to delete.

The catalog SHALL be refreshed whenever the server lists its tools successfully, including a reconnect and a `tools/list` change notification. A listing that fails MUST leave the previous catalog untouched. Removing a server SHALL discard its catalog; disabling one keeps it, so re-enabling restores the tool list without another listing.

#### Scenario: A successful listing is retained

- **WHEN** a server completes a listing with three tools
- **THEN** the host retains those three raw entries for that server

#### Scenario: A change notification refreshes the catalog

- **WHEN** a connected server announces a `tools/list` change and lists a different set
- **THEN** the retained catalog holds the new set and the removed names are gone

#### Scenario: A failed listing keeps the previous catalog

- **WHEN** a reconnect fails before listing any tool
- **THEN** the previously retained catalog is still available for that server

#### Scenario: Removing a server discards its catalog

- **WHEN** the operator removes a server that had a retained catalog
- **THEN** the catalog of that server is discarded

#### Scenario: The catalog carries no secret

- **WHEN** the persisted catalog is read after any successful authorization
- **THEN** it contains no access token, refresh token, client secret, authorization code or authorization URL

### Requirement: Cached definitions while a server needs authentication

When a server is reported `needs-auth` and a retained catalog exists for it, the host SHALL register one model-visible tool per retained entry under the same public name, with the same description and the same input schema the live definition uses. A cached definition MUST NOT be registered for a server that is disabled, conflicting, connecting, configured but not loaded, or in `error`, and MUST NOT be registered when no catalog is retained.

Cached definitions SHALL follow the same tiers as live ones — global and per-workspace — and SHALL obey the same on-demand broker deferral as live ones, so an enabled broker still finds them with `mcp_search_tools` and dispatches them with `mcp_execute_tool`.

#### Scenario: A server that needs authentication exposes its cached tools

- **WHEN** a server with a retained catalog fails authentication while connecting
- **THEN** the model sees one tool per retained entry under the server's usual public names

#### Scenario: A server without a catalog exposes nothing

- **WHEN** a server that never completed a listing needs authentication
- **THEN** the model sees no tool for that server

#### Scenario: Other connection states expose nothing

- **WHEN** a server is disabled, conflicting, connecting, or in `error`
- **THEN** no cached definition is registered for it

#### Scenario: A workspace server keeps its scope

- **WHEN** a workspace server with a retained catalog needs authentication
- **THEN** its cached definitions are visible only inside that workspace, like its live ones

#### Scenario: The broker finds cached definitions

- **WHEN** the on-demand broker is enabled and a server with a retained catalog needs authentication
- **THEN** `mcp_search_tools` returns its cached definitions and `mcp_execute_tool` can address them

### Requirement: A live definition replaces its cached definition

When the server reconnects, the live definition SHALL replace the cached one under the same public name. The model-facing name, description and parameters SHALL remain the server's own, and a public name MUST NOT be registered twice.

#### Scenario: Reconnecting replaces the cached definitions

- **WHEN** the server completes authentication and reconnects
- **THEN** every public name of that server is served by the live definition and no duplicate remains

#### Scenario: A dropped tool disappears after reconnecting

- **WHEN** the server's new listing no longer contains a retained name
- **THEN** that public name is no longer registered after the reconnect

### Requirement: A call to a cached definition fails immediately

A call to a cached definition SHALL fail immediately. It MUST NOT wait for an authorization, MUST NOT publish an attention entry, and MUST NOT be retried.

The error SHALL name the server, state that the call was not executed, and instruct the caller to call `mcp_authenticate_server` with the server's name. The text MUST NOT contain a token, a client secret, an authorization code, a PKCE value or an authorization URL.

#### Scenario: The call fails without waiting

- **WHEN** the model calls a cached definition
- **THEN** the call returns an error at once and nothing is left pending

#### Scenario: No attention entry is published

- **WHEN** the model calls a cached definition
- **THEN** the attention listing contains no entry for that call

#### Scenario: The error names the way to authorize

- **WHEN** the call fails
- **THEN** the error names the server and instructs the caller to call `mcp_authenticate_server` with that name

#### Scenario: No secret in the error

- **WHEN** the call fails
- **THEN** the error text contains no token, client secret, authorization code, PKCE value or authorization URL
