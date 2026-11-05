# mcp-chat-auth Specification

## Purpose
Defines the authentication banner the conversation shows while an MCP tool call is waiting for reauthorization, so the operator can authenticate without leaving the chat window.

## Requirements

### Requirement: The banner appears only for waiting calls of this conversation

When the session that owns the conversation has at least one waiting MCP call, the conversation SHALL render an authentication banner above its composer, inside the conversation column. Otherwise the conversation MUST render no banner.

The banner SHALL list global servers and the servers of the conversation's workspace. It MUST NOT list a server of another workspace or a call owned by another session.

#### Scenario: A call waits in this conversation

- **WHEN** the conversation's own session has a waiting call
- **THEN** the banner is rendered above the composer with one row for that server

#### Scenario: Another session owns the call

- **WHEN** a waiting call belongs to a different session
- **THEN** this conversation renders no banner

#### Scenario: Authentication required without a call

- **WHEN** a server needs authentication but no call is waiting
- **THEN** no banner is rendered

#### Scenario: Workspace scoping

- **WHEN** a server of another workspace is waiting while this conversation's workspace has none
- **THEN** that server is not listed

#### Scenario: Global and workspace servers together

- **WHEN** a global server and a server of this conversation's workspace are both waiting
- **THEN** the banner shows both, each with its own row

#### Scenario: The composer stays usable

- **WHEN** the banner appears while the operator is typing
- **THEN** it does not take focus and the composer accepts input normally

### Requirement: One row per waiting server

Each waiting server SHALL have its own row. The row SHALL show the server name, the reason the call is waiting when one is known, the number of waiting calls, and the time remaining before the deadline.

A row for a workspace server SHALL identify its workspace so it is not read as a global server.

#### Scenario: Row content

- **WHEN** a row is rendered
- **THEN** it shows the server name, the reason, the waiting-call count and the remaining time

#### Scenario: Countdown advances

- **WHEN** the row stays visible
- **THEN** the remaining time decreases until the deadline is reached

#### Scenario: Workspace rows are labelled

- **WHEN** a row belongs to a workspace server
- **THEN** it carries the workspace label

### Requirement: Row states

A row SHALL present the phase reported for its server.

While the server needs authentication, the row SHALL show the reason and SHALL offer an Authenticate action and a Cancel action. While an authorization is running, the row SHALL say that the browser is open, SHALL NOT offer a second Authenticate action, and SHALL keep the Cancel action available. When starting or completing the authorization failed, the row SHALL show the failure text and SHALL offer Authenticate again together with Cancel.

#### Scenario: Waiting for authentication

- **WHEN** the phase is `needs-auth`
- **THEN** the row shows the reason with an Authenticate action and a Cancel action

#### Scenario: Authorization running

- **WHEN** the phase is `authorizing`
- **THEN** the row states that the browser is open, Authenticate is not actionable, and Cancel remains available

#### Scenario: Authorization failed

- **WHEN** starting the authorization or the provider returns an error
- **THEN** the row shows the failure text, Authenticate is actionable again, and Cancel remains available

### Requirement: The Authenticate action starts the existing authorization

Activating Authenticate SHALL start the existing authorization for the row's server in the row's scope. On success the returned authorization URL SHALL open in the system browser, and the conversation MUST NOT navigate away from itself.

A failure to start SHALL be reported inline in that row without removing it. Activating Authenticate while an authorization is already running MUST NOT start another flow.

#### Scenario: Browser opens

- **WHEN** the operator activates Authenticate on a row
- **THEN** the authorization URL opens in the system browser and the conversation stays where it was

#### Scenario: Start failure stays in the row

- **WHEN** starting the authorization fails
- **THEN** the row shows the failure, keeps its Cancel action and does not navigate away

#### Scenario: No duplicate flow

- **WHEN** the operator activates Authenticate twice for the same row
- **THEN** one authorization flow is pending, not two

### Requirement: The Cancel action releases the waiting calls

Activating Cancel SHALL cancel the waiting calls of that server for this conversation's session. The row SHALL disappear, and the canceled calls SHALL receive the actionable error. Cancel MUST NOT disable the server, delete its tokens or change its configuration.

#### Scenario: Cancel removes the row

- **WHEN** the operator activates Cancel on a row
- **THEN** that server's row disappears and the waiting call receives the actionable error

#### Scenario: Cancel keeps the configuration

- **WHEN** the operator cancels
- **THEN** the server's configuration, tokens and enabled state are unchanged

#### Scenario: Another session is unaffected

- **WHEN** another session has waiting calls on the same server
- **THEN** cancelling here leaves that session waiting

### Requirement: The banner disappears with the last waiting call

The banner SHALL disappear when the conversation's last waiting call settles by resuming, being cancelled or reaching its deadline. It MUST NOT remain as a general notice that a server needs authentication.

A new waiting call and a completed authorization SHALL be reflected in the banner without reloading the page.

#### Scenario: The call resumes

- **WHEN** the authorization completes and the call resumes
- **THEN** the row disappears without a page reload

#### Scenario: The deadline is reached

- **WHEN** the waiting call reaches its deadline
- **THEN** the row disappears and the conversation keeps the actionable error in the tool result

#### Scenario: No leftover notice

- **WHEN** the last waiting call has settled
- **THEN** the banner is no longer rendered even if the server still needs authentication

#### Scenario: A new wait is noticed

- **WHEN** a new call starts waiting while the conversation is open
- **THEN** its row appears without a page reload

### Requirement: Localized copy

Every user-visible string the banner introduces SHALL exist in both supported interface languages and SHALL render in the language selected in the application's language setting. Host and provider diagnostic text shown in a row stays in the language it was produced in.

#### Scenario: Both languages are complete

- **WHEN** the interface language is switched between the two supported languages
- **THEN** the banner heading, the actions, the phase texts, the countdown label and the accessible labels are presented in the selected language with no untranslated key shown
