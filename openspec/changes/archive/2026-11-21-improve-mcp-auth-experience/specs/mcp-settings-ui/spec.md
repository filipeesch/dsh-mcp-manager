# Spec Delta

## MODIFIED Requirements

### Requirement: Card action area fits the card

The server card SHALL present its actions as an enable switch whose adjacent label reports the state (`Enabled` or `Disabled`), an Edit action, an Edit as JSON action, a Logs action, a Reauthenticate action for a server that permits browser authorization, and a Delete action. None of them SHALL be hidden behind a menu, except where this specification states otherwise. The card SHALL start collapsed, and its expanded body SHALL contain the tool list, the attempt log and the action row. The action row MUST stay inside the card's bounds at every width the page produces, wrapping instead of overflowing. The same arrangement SHALL be used by a global server card and by a workspace server row; a workspace row SHALL also start collapsed and reveal its actions only when expanded. Delete SHALL keep the existing confirmation dialog.

The status control SHALL report the server's connection state. When the state is that authentication is required, the status control SHALL itself be the authentication action and SHALL keep its current label. Reauthenticate SHALL be available for every server whose authentication mode permits browser authorization, whatever its current state, so an operator can renew a credential before it is rejected.

#### Scenario: OAuth server with every action available

- **WHEN** a global OAuth server card is expanded in the page's layout
- **THEN** the switch, Edit, Edit as JSON, Logs, Reauthenticate and Delete are fully inside the card and no control extends past its edge, and while collapsed only the name and the status control are shown

#### Scenario: Workspace card uses the same arrangement

- **WHEN** a server of a selected workspace renders
- **THEN** it starts collapsed like a global card, and expanding it reveals the same actions with no controls overflowing the row

#### Scenario: Menu opens, closes and confirms deletion

- **WHEN** the operator chooses Delete on a card
- **THEN** a confirmation dialog opens instead of deleting immediately, and cancelling it leaves the server in place

#### Scenario: The status control authenticates a server that needs it

- **WHEN** the card renders for an OAuth server that needs authentication
- **THEN** the status control is the authentication action itself and carries the current status label

#### Scenario: Authenticate stays a direct action

- **WHEN** the card renders for an OAuth server that needs authentication, or that needs a broader scope
- **THEN** the status chip is the authentication action itself and carries the current status label

#### Scenario: A connected server can still be reauthenticated

- **WHEN** the card renders for a connected OAuth server
- **THEN** Reauthenticate is available in the action row

#### Scenario: A server without a browser flow offers no reauthentication

- **WHEN** the card renders for a server whose authentication mode permits no browser authorization
- **THEN** the action row offers no Reauthenticate action

## ADDED Requirements

### Requirement: Provider error text lives in the attempt log

The server card SHALL NOT render the provider's error text. The failure detail of a connection, an authorization or a refresh SHALL be available in that server's attempt log, which already reports each attempt with its phase and status.

A requirement for a broader scope SHALL be the single exception the card states directly, because the remedy differs from renewing a rejected credential: the card SHALL show one neutral line naming the missing scope and SHALL NOT present it as an error. The authentication action's label SHALL state that the new authorization grants the scope.

#### Scenario: A rejected token is not painted in the card

- **WHEN** a server's token is rejected by the provider
- **THEN** the card shows its status control and actions and no provider error text, and the attempt log carries that text

#### Scenario: An insufficient scope is stated neutrally

- **WHEN** a server holds a valid token that lacks a required scope
- **THEN** the card shows one neutral line naming the missing scope, and the authentication action states that it will grant that scope

#### Scenario: The log keeps the detail

- **WHEN** any connection, authorization or refresh attempt fails
- **THEN** that server's attempt log contains an entry describing the failure with no secret value
