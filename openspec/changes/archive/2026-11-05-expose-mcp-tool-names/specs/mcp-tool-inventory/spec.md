# Spec Delta

## Purpose

Defines the host-side inventory of raw tool names that the settings page can read per MCP server: which connection answers, what the names are, how they are ordered, and why the polled list endpoints stay count-only.

## ADDED Requirements

### Requirement: Tool inventory endpoint

The host SHALL expose `GET /mcp-manager/api/servers/:id/tools`, returning `{ tools: [string, ...] }` for a server whose connection is live. The id SHALL resolve a global server, a loaded workspace server, and a workspace row projected from disk, using the same deterministic id addressing that already serves `GET /servers/:id/logs`.

The response SHALL describe only the server's own connection: a global server reports the global connection's tools, and a workspace server reports the connection of that workspace.

For a server that is not connected — `needs-auth`, `error`, `disabled`, `connecting`, `configured`, `conflict`, or a row projected from disk — the endpoint SHALL answer `409` with an error message and MUST NOT return a tool list. An unknown id SHALL answer `404`.

The polled list endpoints `GET /servers` and `GET /workspaces` SHALL remain count-only: they MUST NOT carry tool names, and their payload size MUST NOT grow with the number of tools a server registers.

#### Scenario: Connected global server returns its tools

- **WHEN** the settings page requests `/mcp-manager/api/servers/<global-id>/tools` for a connected global server
- **THEN** the response is `200` with the registered tool names of that connection

#### Scenario: Workspace server answers with its own connection

- **WHEN** the settings page requests the endpoint for a workspace server id
- **THEN** the response is `200` with the tools registered by that workspace connection, not the global connection's tools

#### Scenario: A row projected from disk has no inventory

- **WHEN** the requested id belongs to a workspace row that is declared on disk but not loaded
- **THEN** the endpoint answers `409` and returns no tool list

#### Scenario: A server that needs authentication has no inventory

- **WHEN** the requested server is `needs-auth`, `error`, `disabled`, `connecting`, or `conflict`
- **THEN** the endpoint answers `409` and returns no tool list

#### Scenario: Unknown id is rejected

- **WHEN** the requested id matches no global server, loaded workspace server, or projected workspace row
- **THEN** the endpoint answers `404`

#### Scenario: Polled list endpoints stay cheap

- **WHEN** a server registers hundreds of tools and the page polls `GET /servers` or `GET /workspaces`
- **THEN** those responses carry only the tool count and are byte-for-byte the same shape as before the change

### Requirement: Raw names, ordering and a live inventory

The names returned SHALL be the server's raw `tools/list` names, the same names that appear after the implicit `mcp__<server>__` prefix. The public normalized tool name MUST NOT be returned, distinct tools MUST NOT be merged, and names MUST NOT be rewritten.

The response SHALL be ordered by ascending name, independent of the order in which the server listed the tools, and SHALL NOT contain duplicate names. A connected server that registered no tools SHALL return an empty array rather than an error.

The endpoint SHALL read the live registration state. Names from a previous connection MUST NOT be returned after a disconnect, and a connect, reconnect, edit, or `tools/list` change SHALL be visible on the next request without restarting the host.

#### Scenario: Names are raw

- **WHEN** a server named `github` lists a tool named `search_repos`
- **THEN** the inventory contains `search_repos` and never `mcp__github__search_repos`

#### Scenario: Ordering is stable

- **WHEN** the server lists `zebra`, `alpha`, and `middle`
- **THEN** the inventory is `["alpha", "middle", "zebra"]` regardless of the server's order

#### Scenario: Connected with no tools

- **WHEN** a connected server's `tools/list` returns an empty array
- **THEN** the endpoint answers `200` with `[]`

#### Scenario: The inventory follows a reconnect

- **WHEN** a server reconnects and now exposes a different tool set
- **THEN** the next request returns the new set and the removed names are gone
