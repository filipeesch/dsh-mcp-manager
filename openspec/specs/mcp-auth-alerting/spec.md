# mcp-auth-alerting Specification

## Purpose

Defines the frame-wide alert that tells the operator an MCP authentication wait belongs to a conversation they are not looking at, and the actions it offers without leaving the current screen.

## Requirements

### Requirement: The alert appears only for a wait the operator cannot see

When at least one MCP authentication wait exists and the conversation that owns a wait is not the conversation currently on screen, the application SHALL show a frame-wide alert for it. The alert MUST NOT appear inside the conversation that already renders that wait's banner, and MUST NOT appear when no wait exists.

The alert SHALL remain rendered while the conversation is not visible, including when the
application has a modal surface open over it, because the modal is where the operator is
acting.

The alert is placed in the host overlay slot. Where the host renders that slot beneath a
top-layer surface of its own — such as a first-run notice — the notice covers the card
until it is dismissed. The alert MUST keep its content and actions intact through that
period, and MUST be fully visible and operable once no host surface covers it. Raising it
above a host-owned modal is outside this change: it needs a host-supported layer, and the
client half cannot outrank a modal the host promotes itself.

The alert SHALL be available from every screen of the application, not only from a conversation.

#### Scenario: A wait in another conversation is announced

- **WHEN** a call waits for authentication in a conversation the operator is not looking at
- **THEN** one alert appears for that wait, wherever the operator is

#### Scenario: The owning conversation shows only its banner

- **WHEN** the operator is looking at the conversation that owns the wait
- **THEN** no alert is shown for that wait and the conversation banner reports it

#### Scenario: A modal does not hide the alert

- **WHEN** a wait belongs to the conversation underneath an open Settings dialog
- **THEN** the alert stays rendered, because that conversation is not the surface the operator is acting on, and it is fully operable once the dialog closes

#### Scenario: No wait means no alert

- **WHEN** no call is waiting for authentication
- **THEN** no alert is rendered

### Requirement: The alert identifies the server and its conversation

Each alert SHALL name the server whose call is waiting and the conversation that owns the wait, so the operator can tell where the blocked work is. A conversation with no readable title SHALL be identified by the server name alone rather than by an empty space or an internal identifier.

The alert MUST NOT contain a token, a client secret, an authorization code or an authorization URL.

#### Scenario: Server and conversation are named

- **WHEN** the alert is shown for a wait owned by a titled conversation
- **THEN** it names both the server and that conversation

#### Scenario: An untitled conversation degrades cleanly

- **WHEN** the owning conversation has no readable title
- **THEN** the alert names the server and shows no empty or internal identifier

### Requirement: The alert offers both paths to unblock the call

The alert SHALL offer an action that opens the conversation that owns the wait, and an action that starts the existing authorization for that server. Both actions SHALL be available to the operator without leaving the current screen first.

Starting the authorization from the alert SHALL start the same flow the conversation banner starts, MUST NOT start a second flow while one is running, and MUST NOT navigate the operator away from the screen they are on. A failure to start SHALL be reported in the alert itself and SHALL keep the actions available.

#### Scenario: Go to conversation opens the owner

- **WHEN** the operator activates the navigation action
- **THEN** the application opens the conversation that owns the wait

#### Scenario: Authenticate works from outside the conversation

- **WHEN** the operator activates the authentication action from another screen
- **THEN** the authorization starts for that server and the waiting call can resume, and the operator stays on that screen

#### Scenario: No second flow

- **WHEN** the operator activates the authentication action while an authorization for that server is already running
- **THEN** no additional authorization flow is started

#### Scenario: A failed start keeps the alert usable

- **WHEN** starting the authorization from the alert fails
- **THEN** the alert reports the failure and both actions remain available

### Requirement: The alert lasts as long as its wait

While its wait exists the alert SHALL remain, and the operator SHALL be able to dismiss it. Dismissing one alert SHALL NOT settle, cancel or otherwise change the wait, and SHALL NOT hide a later wait of the same server.

An alert SHALL disappear on its own once its wait settles by resuming, being cancelled or reaching its deadline.

#### Scenario: The alert stays while the wait lasts

- **WHEN** a wait lasts longer than the application's ordinary transient notice
- **THEN** the alert is still shown until the wait settles

#### Scenario: Dismissing does not cancel

- **WHEN** the operator dismisses the alert
- **THEN** the call keeps waiting and the conversation still owns an unsettled wait

#### Scenario: A later wait returns

- **WHEN** the same server begins a new wait after the operator dismissed the previous alert
- **THEN** the alert is shown again for the new wait

#### Scenario: The alert clears by itself

- **WHEN** the wait resumes, is cancelled or reaches its deadline
- **THEN** the alert disappears without a page reload

### Requirement: Several waits stay legible

The application SHALL show a bounded number of alerts as complete cards and SHALL summarize any further waits behind an expandable summary that names how many more there are. Expanding it SHALL reveal the remaining alerts with their own actions. The bound MUST keep the alert layer from covering the application's working area.

Alerts SHALL be ordered predictably, so the same wait keeps its position across updates.

#### Scenario: The bound holds

- **WHEN** more waits exist than the visible bound
- **THEN** the visible count is shown as complete cards and the remainder is reachable through the summary

#### Scenario: The summary reveals the rest

- **WHEN** the operator expands the summary
- **THEN** the remaining alerts are shown with their own actions

#### Scenario: Ordering is stable

- **WHEN** the alert layer updates while several waits exist
- **THEN** each wait keeps its position and no alert jumps between updates
