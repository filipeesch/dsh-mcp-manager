# Spec Delta

## Purpose

Defines the single language the plugin's interface and its shipped documentation use.

## ADDED Requirements

### Requirement: The interface is English-only

Every user-visible string the plugin renders SHALL be English. The client MUST NOT carry a second interface language and MUST NOT select a language from the application's language setting.

Diagnostic text produced by the host, by an authorization server or by an MCP server SHALL stay in the language it was produced in.

#### Scenario: The interface stays English

- **WHEN** the application language setting is changed to any supported value
- **THEN** every label, action, state message and accessible name the plugin renders is English

#### Scenario: No second language remains

- **WHEN** the client bundle is inspected
- **THEN** it contains no second interface language and no lookup that switches on the application language

#### Scenario: Diagnostics are untouched

- **WHEN** the host or a provider returns a diagnostic
- **THEN** it is shown as produced

### Requirement: Shipped documentation is English-only

The package SHALL ship a single README. A localized README MUST NOT be published, linked from the shipped README, or listed in the package file list.

#### Scenario: Only one README ships

- **WHEN** the published package is inspected
- **THEN** it contains one README and no localized variant

#### Scenario: No link to a localized README

- **WHEN** the shipped README is read
- **THEN** it links no localized README
