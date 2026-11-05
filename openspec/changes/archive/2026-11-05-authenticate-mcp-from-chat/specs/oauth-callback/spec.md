# Spec Delta

## MODIFIED Requirements

### Requirement: Plugin-owned callback listener

The plugin SHALL receive OAuth callbacks on HTTP listener(s) that it opens itself, independently of the DSH web interface. The web interface MUST NOT host an OAuth callback route, and the listener MUST NOT require it to be mounted.

A listener MUST bind loopback interfaces only. It SHALL be started when an authorization flow needs it and MUST NOT be opened at plugin startup or only to display a redirect URI. Starting an authorization remains an operator action available from Settings → MCP, from a workspace row and from the conversation authentication banner, so a profile that provides no web interface has no trigger of its own.

#### Scenario: The web interface hosts no callback route

- **WHEN** the plugin mounts its API on a web interface
- **THEN** no OAuth callback path is registered there, and a callback is received only by the plugin's own listener

#### Scenario: No listener before authentication

- **WHEN** the plugin has loaded with OAuth servers that need authentication and no authorization has started
- **THEN** no callback port is bound

#### Scenario: Loopback-only binding

- **WHEN** a callback address resolves to anything other than a loopback interface
- **THEN** the listener is not opened and the attempt fails with an actionable message
