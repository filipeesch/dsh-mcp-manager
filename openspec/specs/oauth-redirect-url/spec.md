# oauth-redirect-url Specification

## Purpose
Defines the OAuth redirect URI an MCP server presents to its authorization server: the derived default, the per-server override an operator can set, the validation that override must pass, and how one pinned value is kept consistent across dynamic client registration, the authorization request and the token exchange.

## Requirements

### Requirement: Derived default redirect URI

When a server has no override configured and the global callback mode is automatic, the plugin SHALL present a redirect URI of the form `http://localhost:<port>/callback`, where the port is allocated by the callback subsystem and is bound on loopback before the authorization starts. The default host SHALL be `localhost` and the default path SHALL be `/callback`.

The redirect URI MUST NOT depend on the request that starts the authorization, on the host or port the DSH web interface is served on, or on a deployment-wide public origin. A rejected or unavailable address MUST NOT produce a URI.

#### Scenario: Automatic allocation

- **WHEN** a server with no override and no global fixed configuration starts authorization
- **THEN** the redirect URI is `http://localhost:<port>/callback` for the port the plugin bound

#### Scenario: Independent of the web interface

- **WHEN** the DSH web interface is served on one port and no override is configured
- **THEN** the redirect URI names the callback listener's port, not the web interface's port

#### Scenario: Loopback always reachable

- **WHEN** the callback URI names `localhost` and the plugin could bind only the IPv4 loopback address
- **THEN** the same `localhost` URI is presented and it still resolves to the running listener

#### Scenario: Local GUI reached through the loopback IP

- **WHEN** authorization starts while the GUI is served on `127.0.0.1:49593`, with no override and no global fixed configuration
- **THEN** the redirect URI is `http://localhost:<allocated port>/callback`, not the GUI's port

#### Scenario: Local GUI reached through localhost

- **WHEN** authorization starts while the GUI is served on `localhost:49593`, with no override and no global fixed configuration
- **THEN** the redirect URI is `http://localhost:<allocated port>/callback`, identical to the IPv4 case

#### Scenario: Configured public origin

- **WHEN** a profile still carries a `publicOrigins` value written by an earlier version
- **THEN** that value does not participate in redirect resolution and the callback continues to name the loopback listener

#### Scenario: Foreign request host

- **WHEN** authorization starts from a request addressed to a foreign or proxied host
- **THEN** the request is accepted and the redirect URI is the loopback listener's, because the URI no longer derives from the request

### Requirement: Per-server redirect override

The plugin SHALL accept an optional, non-secret redirect URI per server and SHALL persist it with that server's configuration, for both the global tier and workspace-declared servers. The value SHALL accept `scheme://host[:port][/path]`, with `http` as the default scheme, and MUST NOT carry a query, fragment or userinfo.

The host, port and path are optional only in the sense defined here: a missing port or path SHALL inherit the global fixed callback configuration when the global mode is fixed, and SHALL otherwise fall back to an automatically allocated port and the default path `/callback`. An explicit port is used verbatim and an explicit path is used as given.

#### Scenario: Explicit port is used verbatim

- **WHEN** the override is `http://127.0.0.1:8080/provider-callback`
- **THEN** the redirect URI is `http://127.0.0.1:8080/provider-callback` and a listener is bound on that port

#### Scenario: Bare host inherits the current port

- **WHEN** the override is `localhost` and no port is given
- **THEN** the port is the global fixed port when the mode is fixed, and an automatically allocated port otherwise

#### Scenario: Override wins over a configured public origin

- **WHEN** a profile still carries a legacy `publicOrigins` value and the server's override is `localhost:49593`
- **THEN** the redirect URI is `http://localhost:49593/callback` and the legacy origin is ignored

#### Scenario: Bare host while a public origin names the callback

- **WHEN** a profile still carries a legacy `publicOrigins` value, the override is `localhost`, and the global mode is automatic
- **THEN** the redirect URI uses `localhost` with an allocated port and the default path, never the legacy origin

#### Scenario: Override survives a restart on another port

- **WHEN** a server override of `localhost` was saved and the plugin restarts and allocates another port
- **THEN** the redirect URI follows the new allocation without any further edit

#### Scenario: Bare host in fixed mode inherits the global configuration

- **WHEN** the global mode is fixed at port `8787` with path `/callback` and the override is `localhost`
- **THEN** the redirect URI is `http://localhost:8787/callback`

#### Scenario: Bare host in automatic mode

- **WHEN** the global mode is automatic and the override is `localhost`
- **THEN** the redirect URI uses `localhost` with an automatically allocated port and the path `/callback`

#### Scenario: Different paths share one port

- **WHEN** two servers override the same host and port with different paths
- **THEN** one listener serves both paths and each server presents its own URI

#### Scenario: Workspace override preserved by a partial edit

- **WHEN** a workspace server's stored override is present and an edit payload omits it
- **THEN** the stored override remains in the workspace entry and remains in effect

### Requirement: Override validation

The plugin SHALL reject a redirect override whose host is not a loopback literal: the name `localhost`, an address in `127.0.0.0/8`, or `::1`. It SHALL reject a scheme other than `http`, a path that does not start with `/`, and any query, fragment or userinfo. A rejected value MUST NOT be persisted, MUST NOT start an authorization, and the returned error MUST name the reason.

#### Scenario: Non-allowlisted public host

- **WHEN** the operator saves `https://mcp.example.com/callback`
- **THEN** the save is rejected with an error stating that only loopback callback addresses are accepted, and the stored configuration is unchanged

#### Scenario: Allowlisted public origin

- **WHEN** the operator saves an origin that an earlier version would have accepted through `publicOrigins`
- **THEN** the save is rejected, because that allowlist no longer exists and the listener cannot bind a public address

#### Scenario: Value carrying a path

- **WHEN** the operator saves `http://localhost:49593/provider-callback`
- **THEN** the save is accepted and that path is used as the callback path

#### Scenario: HTTPS on a loopback host

- **WHEN** the operator saves `https://localhost:8080/callback`
- **THEN** the save is rejected with an error explaining that the callback listener is served over plain HTTP

#### Scenario: Path with a query string

- **WHEN** the operator saves `http://localhost:8080/callback?x=1`
- **THEN** the save is rejected with an error stating that a callback path carries no query or fragment

#### Scenario: Rejected value leaves state untouched

- **WHEN** a save is rejected
- **THEN** the previously stored value remains in effect and no listener is opened

### Requirement: One redirect URI per authorization attempt

The plugin SHALL fix the redirect URI when an authorization attempt starts and SHALL use that same value for the dynamic client registration, the authorization request and the token exchange. The token exchange MUST NOT derive the redirect URI from the callback request, and MUST NOT proceed when no pending attempt exists for the server.

#### Scenario: Override used end to end

- **WHEN** authorization starts for a server overriding `localhost`, the authorization server registers the client, and the callback returns the code
- **THEN** the registration's `redirect_uris`, the authorization request's `redirect_uri` and the token request's `redirect_uri` are the same value

#### Scenario: Callback arrives through another host

- **WHEN** the authorization started with redirect URI `http://localhost:49593/mcp-manager/callback/<server-id>` and the callback request itself is addressed to a different Host
- **THEN** the token exchange still sends `http://localhost:49593/mcp-manager/callback/<server-id>`

#### Scenario: Callback without a pending attempt

- **WHEN** a callback arrives for a server with no pending authorization attempt, or with a state that does not match the pending one
- **THEN** no token request is made and the page reports an expired or invalid session

### Requirement: Redirect change keeps existing credentials

Saving a redirect override SHALL NOT delete the server's stored registration or tokens: until the next authentication, the previous registration remains valid and token refresh continues to use it. On the next authentication, a dynamically registered client whose registration was bound to a different redirect URI SHALL be registered again for the new redirect, and the previous client's token pair SHALL be dropped, because that client cannot refresh a token issued under another redirect. A manually configured Client ID SHALL NOT be registered again in any case.

#### Scenario: Saving a new override keeps the session

- **WHEN** the operator saves a different redirect override for a server that is authenticated
- **THEN** the stored tokens and registration are retained and the next token refresh succeeds

#### Scenario: Next authentication re-registers

- **WHEN** the operator then starts authentication and the authorization server supports dynamic client registration
- **THEN** a new client is registered with the new redirect URI, and the token pair issued to the previous client is discarded

#### Scenario: Manual Client ID is never re-registered

- **WHEN** the server has a manually configured Client ID and the operator changes the redirect override
- **THEN** no registration request is made and the configured redirect URI is used as-is in the authorization request

### Requirement: Workspace servers carry their own override

A workspace-declared OAuth server SHALL store its redirect override in its own workspace entry, SHALL use it for that server's authorization flow, and SHALL keep it when an edit omits the field. An override that a hand-edited workspace file supplies MUST be honored.

#### Scenario: Workspace override used

- **WHEN** a workspace entry declares `redirectUrl: "localhost"` and its authentication starts
- **THEN** that server's redirect URI uses `localhost` with the current GUI port

#### Scenario: Partial edit preserves the override

- **WHEN** a workspace server is edited through a payload that omits `redirectUrl`
- **THEN** the previously stored override remains in the workspace entry and remains in effect

#### Scenario: Hand-edited workspace value

- **WHEN** a workspace file is edited by hand to add `redirectUrl` and the workspace is rescanned
- **THEN** the value takes effect for that server's next authorization

### Requirement: Global callback configuration

The plugin SHALL persist a global callback configuration holding a mode (`automatic` or `fixed`), a hostname, a port and a path, and SHALL expose it for editing through the interface. In automatic mode the hostname and path default to `localhost` and `/callback` and the port is allocated per authorization. In fixed mode the port SHALL be required and the hostname and path SHALL define the callback address presented to every server without an override.

Saving SHALL validate the shape and the loopback rule without binding the port. The port SHALL be bound when an authorization starts, and a value that passes validation but cannot be bound then SHALL fail that attempt with an actionable error instead of being replaced.

#### Scenario: Default automatic configuration

- **WHEN** no global callback configuration exists
- **THEN** the effective mode is automatic with hostname `localhost` and path `/callback`

#### Scenario: Fixed mode requires a port

- **WHEN** the operator selects fixed mode without a port and saves
- **THEN** the save is rejected with an error naming the missing port and the configuration is unchanged

#### Scenario: Saving does not bind the port

- **WHEN** the operator saves a valid fixed configuration while another process occupies the port
- **THEN** the save succeeds without opening a socket and the conflict is reported when an authorization starts

#### Scenario: Invalid host is rejected

- **WHEN** the operator saves fixed mode with hostname `mcp.example.com`
- **THEN** the save is rejected because the callback listener can only bind loopback

### Requirement: Redirect resolution precedence

The plugin SHALL resolve one redirect URI per authorization attempt using this precedence: the per-server redirect override, then the global fixed callback configuration, then automatic allocation. The resolved URI SHALL be used unchanged for dynamic client registration, the authorization request and the token exchange.

#### Scenario: Override beats the global configuration

- **WHEN** the global mode is fixed and the server has an override
- **THEN** the override determines the redirect URI

#### Scenario: Global configuration fills the gap

- **WHEN** the global mode is fixed and the server has no override
- **THEN** the global hostname, port and path determine the redirect URI

#### Scenario: Nothing configured

- **WHEN** the global mode is automatic and the server has no override
- **THEN** the plugin allocates a loopback port and presents `http://localhost:<port>/callback`

### Requirement: Stored redirect value that cannot be served

The plugin MUST NOT silently replace a stored redirect override that cannot be served. When a stored value names a non-loopback host or uses `https`, the next authorization SHALL fail with a message naming the stored value and the accepted forms, the stored value SHALL remain unchanged, and the interface SHALL surface the problem.

#### Scenario: A legacy non-loopback value fails loudly

- **WHEN** a server still stores a non-loopback redirect value written by an earlier version and authorization starts
- **THEN** the attempt fails with a message naming the stored value, and no authorization URL is returned

#### Scenario: No silent fallback

- **WHEN** a stored override cannot be served
- **THEN** the plugin does not fall back to an automatically allocated URI for that attempt

#### Scenario: The value is not rewritten

- **WHEN** such a stored value fails an authorization
- **THEN** the stored configuration is unchanged so the operator can inspect and correct it
