# mcp-on-demand-tools Specification

## Purpose

Defines when the on-demand MCP broker is active, including the default for a profile that never chose a value, and the boundary at which Code/PTC presentations keep their full MCP catalog.

## Requirements

### Requirement: On-demand broker default and activation

When the persisted profile state carries no `onDemandToolInjection` value, the host SHALL treat the on-demand broker as enabled. An explicitly stored `false` SHALL keep it disabled, and an explicitly stored `true` SHALL keep it enabled.

While the broker is enabled the host SHALL register `mcp_search_tools`, `mcp_describe_tool`, and `mcp_execute_tool`; SHALL mark the direct `mcp__*` definitions deferred on harnesses that support the deferred-loading marker; and SHALL deny direct MCP tool calls except the broker's own dispatch. While the broker is disabled those definitions SHALL be registered directly and no broker tools SHALL exist.

`GET /settings` SHALL report the effective value, and `POST /settings/on-demand` SHALL persist a change and apply it to live registrations without a reconnect.

#### Scenario: A profile that never chose a value gets the broker

- **WHEN** the plugin starts with a state file that has no `onDemandToolInjection` value
- **THEN** the broker tools are registered, direct `mcp__*` definitions are marked deferred, and `GET /settings` reports the setting as enabled

#### Scenario: An explicit false is respected

- **WHEN** the state file stores `onDemandToolInjection: false`
- **THEN** no broker tools are registered, direct MCP tools stay directly callable, and `GET /settings` reports the setting as disabled

#### Scenario: Toggling applies without a reconnect

- **WHEN** the operator disables the broker while a server is connected
- **THEN** the broker tools are withdrawn and the direct definitions lose the deferred marker without reconnecting the server

#### Scenario: Toggling persists

- **WHEN** the operator enables the broker from the page
- **THEN** the value is persisted and the next `GET /settings` reports it as enabled

### Requirement: Code and PTC presentations keep the full catalog

An agent whose executor owns prompt sections — a Code, PTC, or both presentation — SHALL keep its complete session-visible MCP catalog while the broker is enabled. The host SHALL NOT filter or defer that presentation's `mcp__*` tools, and a direct call made by such an agent SHALL be admitted.

The broker definitions MAY remain registered and be used by other agents. When the same agent later assembles as a native presentation, the direct tools SHALL be deferred and direct calls denied again.

#### Scenario: A Code presentation keeps every tool

- **WHEN** a Code/PTC agent runs while the broker is enabled
- **THEN** its model-facing catalog still contains the direct `mcp__*` tools and a direct call from that agent is admitted

#### Scenario: A native agent stays restricted

- **WHEN** a native agent runs while the broker is enabled
- **THEN** its direct `mcp__*` tools are deferred, a direct call is denied, and the broker's nested dispatch is admitted

#### Scenario: Switching presentation re-applies the restriction

- **WHEN** an agent that assembled as a Code presentation later assembles as native
- **THEN** its direct MCP tools are deferred and direct calls are denied from then on
