# Spec Delta

## MODIFIED Requirements

### Requirement: Card action area fits the card

The expanded server card SHALL present its actions as an enable switch whose adjacent label reports the state (`Enabled` or `Disabled`), an Edit action and a Delete action, and MUST NOT hide any of them behind a menu. When the server needs authentication, the status chip SHALL itself be the authentication action; a connected server SHALL show a plain status chip and no re-authentication control. The card SHALL start collapsed, and its expanded body SHALL contain the tool list, the attempt log and the action row. The action row MUST stay inside the card's bounds at every width the page produces, wrapping instead of overflowing. The same arrangement SHALL be used by a global server card and by a workspace server row; a workspace row SHALL also start collapsed and reveal its actions only when expanded. Delete SHALL keep the existing confirmation dialog.

#### Scenario: OAuth server with every action available

- **WHEN** a global OAuth server card is expanded in the page's layout
- **THEN** the switch, Edit and Delete are fully inside the card and no control extends past its edge, and while collapsed only the name and the status chip are shown

#### Scenario: Workspace card uses the same arrangement

- **WHEN** a server of a selected workspace renders
- **THEN** it starts collapsed like a global card, and expanding it reveals the switch, Edit and Delete with no controls overflowing the row

#### Scenario: Menu opens, closes and confirms deletion

- **WHEN** the operator chooses Delete on a card
- **THEN** a confirmation dialog opens instead of deleting immediately, and cancelling it leaves the server in place

#### Scenario: Authenticate stays a direct action

- **WHEN** the card renders for an OAuth server that needs authentication, or that needs a broader scope
- **THEN** the status chip is the authentication action itself and carries the current status label

### Requirement: Localized labels for the new controls

Every user-visible string introduced by this change SHALL be present in both supported interface languages, and the page SHALL render them in the language selected in the application's language setting. This covers the redirect URI field and its help text, the automatic-mode and manual-Client-ID messages, the enable switch state labels, the card and workspace action labels, the global callback section and its mode, hostname, port and path labels, its status line, and its listener list, together with the tool-list heading and count, each tool-list state message, the tool-list read-failure message, the add action label, and the empty-workspace hint. Host-generated diagnostic text (a listener error such as a busy port, or a provider message) stays in the language the plugin produced, like every other server-supplied diagnostic.

#### Scenario: Both languages are complete

- **WHEN** the interface language is switched between the two supported languages
- **THEN** the redirect URI label and help text, the callback section labels, the status line, the listener list, the pending-registration message, the tool-list heading and state messages, the add action, and the diagnostics are all presented in the selected language, with no untranslated key shown

## ADDED Requirements

### Requirement: Tool list on the server card

The expanded body of a server card SHALL list the raw names of the tools that server registered, under a heading that reports how many there are. The names SHALL be the server's raw `tools/list` names; the implicit `mcp__<server>__` prefix MUST NOT be rendered and the public normalized name MUST NOT replace the raw one.

The list SHALL be ordered. It SHALL render inside a bounded scroll area, and a long name SHALL wrap instead of overflowing the card, so the card's height does not grow with the number of tools. While the card is collapsed no tool list SHALL be present.

The list SHALL follow the page's existing server poll: after a connect, a reconnect, an edit, or a change reported by the server's `tools/list`, the names SHALL refresh without a page reload. The list SHALL be read for the card's own connection, and the same presentation SHALL be used by a global card and by a workspace card.

#### Scenario: Connected card lists the raw names

- **WHEN** the operator expands the card of a connected server
- **THEN** the card shows every registered tool by its raw name, in order, with the count in the heading

#### Scenario: Collapsed card shows no list

- **WHEN** the card is collapsed
- **THEN** no tool names are rendered

#### Scenario: A long list does not change the layout

- **WHEN** a connected server registers far more tools than fit in the card
- **THEN** the list scrolls inside its bounded area, the card's height stays bounded, and every name remains reachable

#### Scenario: A long name wraps

- **WHEN** a tool name is wider than the card body
- **THEN** the name wraps inside the list instead of overflowing the card

#### Scenario: The list follows a reconnect

- **WHEN** a connected server reconnects or its `tools/list` changes
- **THEN** the expanded card shows the new set of names without a page reload, and removed names disappear

#### Scenario: Workspace card uses its own connection

- **WHEN** the operator expands a workspace server card
- **THEN** the list shows the tools of that workspace's connection, not another workspace's or the global server's

### Requirement: Tool-list empty states

The tool section SHALL present a distinct message for each connection state it can observe: `needs-auth`, `error`, `disabled`, `connecting`, `configured` (declared but not connected), `conflict`, and connected-but-empty. A server that is not connected MUST NOT render a tool list, and a failed read SHALL be reported as a read failure rather than as an empty inventory.

#### Scenario: Authentication required

- **WHEN** the card belongs to a server whose status is `needs-auth`
- **THEN** the tool section states that authentication is required and shows no names

#### Scenario: Connection error

- **WHEN** the card belongs to a server whose status is `error`
- **THEN** the tool section states that the inventory is unavailable because the server failed, and shows no names

#### Scenario: Disabled server

- **WHEN** the card belongs to a server that is disabled globally or in the selected workspace
- **THEN** the tool section states that the server is disabled and shows no names

#### Scenario: Connecting

- **WHEN** the card belongs to a server that is still connecting
- **THEN** the tool section reports that state instead of an empty inventory

#### Scenario: Declared but not connected

- **WHEN** the card belongs to a workspace server that is declared on disk but not loaded
- **THEN** the tool section says it is configured but not connected and shows no names

#### Scenario: Connected with no tools

- **WHEN** a connected server registered no tools
- **THEN** the tool section says the server is connected but exposes no tools

#### Scenario: A failed read is not an empty list

- **WHEN** reading the inventory fails
- **THEN** the card reports a read failure and does not present the absence of names as the server's inventory

#### Scenario: Workspace rows use the same messages

- **WHEN** a workspace server card shows an empty state
- **THEN** it uses the same state messages as a global card, in the selected language

### Requirement: Add action beside the server search

The page SHALL place the add action in a toolbar beside the server search input in the global view, and beside the workspace selector in the workspace view. The add action SHALL use the application's primary action color and SHALL keep an accessible name. It MUST NOT remain in the page header. Empty-state copy that refers to adding a server SHALL describe the toolbar location.

#### Scenario: Global view toolbar

- **WHEN** the global server view renders
- **THEN** the search input and the add action share one toolbar row, and the add action is visible without scrolling past the list

#### Scenario: Workspace view toolbar

- **WHEN** a workspace is selected
- **THEN** the workspace selector and the add action share one toolbar row

#### Scenario: The header no longer offers the action

- **WHEN** the page header renders in either view
- **THEN** it contains the title and the server count but no add action

#### Scenario: Empty workspace copy matches the new location

- **WHEN** a selected workspace has no servers of its own
- **THEN** the empty-state text points to the toolbar next to the workspace selector

#### Scenario: The action is named

- **WHEN** assistive technology reads the add action
- **THEN** it exposes the localized accessible name for adding an MCP server
