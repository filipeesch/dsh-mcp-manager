# Spec Delta

## MODIFIED Requirements

### Requirement: One row per waiting server

Each waiting server SHALL have its own row. The row SHALL show the server name, the number of waiting calls, and the time remaining before the deadline, and SHALL show the reason the call is waiting only when that reason is actionable - a required scope or a refused authorization - and SHALL omit the transport's own token-rejection wording, which the attempt log keeps.

A row for a workspace server SHALL identify its workspace so it is not read as a global server.

The banner SHALL render as a compact card aligned with the composer: the composer's own maximum width, corner radius, surface and elevation, so it reads as part of the composer stack rather than as a page-level block. It MUST NOT span the full width of the conversation column.

At most three rows SHALL be visible at once. When more servers wait, the banner SHALL fold the remainder behind an expandable summary that states how many are hidden, and expanding it SHALL reveal the remaining rows with their own actions.

#### Scenario: Row content

- **WHEN** a row is rendered
- **THEN** it shows the server name, the waiting-call count and the remaining time

#### Scenario: An actionable reason is shown

- **WHEN** a row's wait is caused by an insufficient scope or a refused authorization
- **THEN** the row states that reason

#### Scenario: Provider rejection wording stays out of the row

- **WHEN** a row's wait is caused by a token the provider simply rejected
- **THEN** the row shows no provider error text, and that text remains in the server's attempt log

#### Scenario: Countdown advances

- **WHEN** the row stays visible
- **THEN** the remaining time decreases until the deadline is reached

#### Scenario: Workspace rows are labelled

- **WHEN** a row belongs to a workspace server
- **THEN** it carries the workspace label

#### Scenario: The banner matches the composer

- **WHEN** the banner is rendered in a conversation
- **THEN** its width, corner radius, surface and elevation match the composer's own, and it does not span the whole column

#### Scenario: Many servers fold behind a summary

- **WHEN** more than three servers wait at once
- **THEN** three rows are shown, the banner states how many more are waiting, and expanding the summary reveals the rest with their actions
