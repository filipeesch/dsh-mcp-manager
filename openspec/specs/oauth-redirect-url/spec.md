# oauth-redirect-url Specification

## Purpose
Defines the OAuth redirect URI an MCP server presents to its authorization server: the derived default, the per-server override an operator can set, the validation that override must pass, and how one pinned value is kept consistent across dynamic client registration, the authorization request and the token exchange.

## Requirements

### Requirement: Derived default redirect URI

When a server has no override configured, the plugin SHALL build the redirect URI as `<origin>/mcp-manager/callback/<server-id>` and SHALL derive the origin from the request that starts the authorization flow, subject to these rules:

- A loopback request host SHALL supply the host and port, except that the name `localhost` SHALL be replaced by the loopback IPv4 literal `127.0.0.1`, so the derived default always names a loopback IP.
- When exactly one origin is configured in `config.publicOrigins`, that origin SHALL be the default regardless of the request host.
- A request host that is neither loopback nor an allowed public origin SHALL NOT become the redirect origin; the request MUST be rejected.
- The derived origin MUST carry the port the GUI is actually served on; an origin without a port MUST NOT be produced for a loopback default.

#### Scenario: Local GUI reached through the loopback IP

- **WHEN** authorization starts from a request whose Host is `127.0.0.1:49593`, with no override and no configured public origin
- **THEN** the redirect URI is `http://127.0.0.1:49593/mcp-manager/callback/<server-id>`

#### Scenario: Local GUI reached through localhost

- **WHEN** authorization starts from a request whose Host is `localhost:49593`, with no override and no configured public origin
- **THEN** the redirect URI is `http://127.0.0.1:49593/mcp-manager/callback/<server-id>`

#### Scenario: Configured public origin

- **WHEN** `config.publicOrigins` contains exactly one origin, `https://harness.example.com`, and the server has no override
- **THEN** the redirect URI is `https://harness.example.com/mcp-manager/callback/<server-id>`

#### Scenario: Foreign request host

- **WHEN** authorization starts from a request whose Host is neither loopback nor listed in `config.publicOrigins`
- **THEN** the request is answered with an error status, no authorization URL is returned, and no authorization attempt is recorded for that server

### Requirement: Per-server redirect override

The plugin SHALL accept an optional, non-secret redirect URL per server and SHALL persist it with that server's configuration, for both the global tier and workspace-declared servers. An override SHALL accept `host`, `host:port`, or `scheme://host[:port]`, with `http` as the default scheme, and MUST NOT carry a path, query, fragment or userinfo: the callback path `/mcp-manager/callback/<server-id>` is always the plugin's.

An override SHALL take precedence over the derived default, including over a configured public origin. When an override omits the port, the plugin SHALL inherit the port the request reached the GUI on locally — the port named by a loopback request, otherwise the listening port the connection landed on — so the value keeps working after the GUI restarts on a different port and remains correct when a configured public origin or a proxy names the browser-facing callback. When an override states a port, that port SHALL be used verbatim.

#### Scenario: Bare host inherits the current port

- **WHEN** the server's override is `localhost` and authorization starts from a request served on port `49593`
- **THEN** the redirect URI is `http://localhost:49593/mcp-manager/callback/<server-id>`

#### Scenario: Explicit port is used verbatim

- **WHEN** the server's override is `localhost:8080` and the GUI is served on port `49593`
- **THEN** the redirect URI is `http://localhost:8080/mcp-manager/callback/<server-id>`

#### Scenario: Override wins over a configured public origin

- **WHEN** `config.publicOrigins` contains `https://harness.example.com` and the server's override is `localhost:49593`
- **THEN** the redirect URI is `http://localhost:49593/mcp-manager/callback/<server-id>`

#### Scenario: Bare host while a public origin names the callback

- **WHEN** `config.publicOrigins` contains `https://harness.example.com`, the server's override is `localhost`, and the GUI is reached locally on port `49593`
- **THEN** the redirect URI is `http://localhost:49593/mcp-manager/callback/<server-id>`, not the public origin's default port

#### Scenario: Override survives a restart on another port

- **WHEN** a server override of `localhost` was saved and the GUI later starts on port `50123`
- **THEN** the redirect URI is `http://localhost:50123/mcp-manager/callback/<server-id>` without any further edit

### Requirement: Override validation

The plugin SHALL reject a redirect override whose host is neither a loopback host (`localhost`, the IPv4 loopback range, or `::1`) nor an origin listed in `config.publicOrigins`. It SHALL reject a value carrying a path, query, fragment or userinfo, and SHALL reject the `https` scheme on a loopback host unless that origin is listed in `config.publicOrigins`, because the plugin's callback receiver is plain HTTP. A rejected value MUST NOT be persisted, MUST NOT start an authorization, and the returned error MUST name the reason.

#### Scenario: Non-allowlisted public host

- **WHEN** the operator saves `https://mcp.example.com` and that origin is not listed in `config.publicOrigins`
- **THEN** the save is rejected with an error naming the allowlist requirement and the stored configuration is unchanged

#### Scenario: Allowlisted public origin

- **WHEN** the operator saves `https://harness.example.com` and that origin is listed in `config.publicOrigins`
- **THEN** the save is accepted and the value is persisted

#### Scenario: HTTPS on a loopback host

- **WHEN** the operator saves `https://localhost` and that origin is not listed in `config.publicOrigins`
- **THEN** the save is rejected with an error explaining that a loopback callback is served over plain HTTP

#### Scenario: Value carrying a path

- **WHEN** the operator saves `http://localhost:49593/mcp-manager/callback/x`
- **THEN** the save is rejected with an error stating that only the origin is configurable and the callback path is fixed by the plugin

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
