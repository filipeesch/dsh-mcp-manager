# Spec Delta

## MODIFIED Requirements

### Requirement: Tool list on the server card

The expanded body of a server card SHALL list the raw names of the tools that server registered, under a heading that reports how many there are. The names SHALL be the server's raw `tools/list` names; the implicit `mcp__<server>__` prefix MUST NOT be rendered and the public normalized name MUST NOT replace the raw one.

The list SHALL be ordered. It SHALL render inside a bounded scroll area, and a long name SHALL wrap instead of overflowing the card, so the card's height does not grow with the number of tools. While the card is collapsed no tool list SHALL be present.

The list SHALL follow the page's existing server poll: after a connect, a reconnect, an edit, or a change reported by the server's `tools/list`, the names SHALL refresh without a page reload. The list SHALL be read for the card's own connection, and the same presentation SHALL be used by a global card and by a workspace card.

A `needs-auth` server that retains a tool catalog SHALL render that catalog under the same heading, together with a stale badge stating that the names come from the last successful listing. Such a list MUST NOT be presented as the server's live inventory, and the badge SHALL disappear once the server reconnects.

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

#### Scenario: Cached names while authentication is required

- **WHEN** the operator expands the card of a `needs-auth` server that retains a catalog
- **THEN** the card lists the retained raw names with the count in the heading and a stale badge

#### Scenario: The badge disappears after reconnecting

- **WHEN** the server authenticates and reconnects with a different tool set
- **THEN** the card lists the live names and no stale badge without a page reload

### Requirement: Tool-list empty states

The tool section SHALL present a distinct message for each connection state it can observe: `needs-auth`, `error`, `disabled`, `connecting`, `configured` (declared but not connected), `conflict`, and connected-but-empty. A server that is not connected MUST NOT render a tool list, except a `needs-auth` server that retains a catalog and renders it marked stale. A failed read SHALL be reported as a read failure rather than as an empty inventory.

#### Scenario: Authentication required

- **WHEN** the card belongs to a `needs-auth` server that retains no catalog
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

### Requirement: Overflow menu with the JSON entry points

In both page layouts the Settings → MCP page SHALL offer an overflow action
labelled `⋯` immediately after the add action: beside the server search when the
global view is shown, and beside the workspace selector when a workspace is shown.
The overflow action SHALL be available in the workspace layout only while a
workspace is selected, matching the add action it follows.

Activating it SHALL open a menu holding exactly two entries, **Edit JSON** and
**Import JSON**. Edit JSON SHALL open the JSON dialog seeded with the current
configuration of the scope being shown; Import JSON SHALL open the same dialog with
an empty document. Choosing an entry SHALL close the menu, and dismissing the menu
outside it or with the keyboard SHALL leave the page unchanged. Neither entry SHALL
navigate away from the page, and the menu SHALL NOT be the only way to reach those
actions from a server card.

Every label the menu introduces SHALL be English and MUST NOT switch with the
application's language setting.

#### Scenario: Global layout exposes the menu

- **WHEN** the global view is shown
- **THEN** the overflow action follows the add action beside the search field and opens a menu with Edit JSON and Import JSON

#### Scenario: Workspace layout exposes the menu

- **WHEN** a workspace is selected
- **THEN** the overflow action follows the add action beside the workspace selector and offers the same two entries

#### Scenario: No workspace selected

- **WHEN** the workspace layout is shown with no workspace selected
- **THEN** the overflow action is not rendered, like the add action it follows

#### Scenario: Menu entries open the dialog differently

- **WHEN** the operator chooses Edit JSON, and then repeats with Import JSON
- **THEN** the first opens the dialog holding the current scope's servers and the second opens it empty

#### Scenario: Dismissing the menu changes nothing

- **WHEN** the operator opens the menu and dismisses it without choosing an entry
- **THEN** no dialog opens and the page state is unchanged

#### Scenario: Both languages are complete

- **WHEN** the application language setting is changed to any supported value
- **THEN** the two menu entries and the overflow action's accessible label stay in English with no untranslated key shown

### Requirement: Edit as JSON action on the server card

The expanded server card of both tiers SHALL present an **Edit as JSON** action in
the visible action row, next to the Edit action and outside the overflow menu, in
addition to the actions that row already carries. The action SHALL open the JSON
dialog locked to that server: the document is seeded with that server's current
entry, the scope is the scope the card belongs to, and a document naming any other
server SHALL be rejected in the preview. Opening it SHALL NOT disturb the server's
connection or its stored session, and the action SHALL remain available for a
disabled server.

The action's label SHALL be English and MUST NOT switch with the application's
language setting.

#### Scenario: Global card offers the action

- **WHEN** a global server card is expanded
- **THEN** Edit as JSON sits in the action row beside Edit and opens the dialog holding only that server's entry

#### Scenario: Workspace card offers the action

- **WHEN** a workspace server card is expanded
- **THEN** the same action opens the dialog locked to that server and to that workspace

#### Scenario: Another server in the document is rejected

- **WHEN** the dialog opened from a card receives a document naming a second server
- **THEN** the preview reports that entry against the locked name and nothing is written

#### Scenario: Cancelling leaves the server untouched

- **WHEN** the operator opens the action and cancels
- **THEN** the server's configuration, connection, and stored session are unchanged

#### Scenario: Disabled server still offers the action

- **WHEN** the card belongs to a disabled server
- **THEN** Edit as JSON is available and applying an edit leaves the server disabled

## REMOVED Requirements

### Requirement: Localized labels for the new controls

**Reason**: The plugin's interface is English-only now, defined by the `plugin-language` capability. A per-surface bilingual obligation would contradict it.

**Migration**: No action needed. Every string this requirement covered is already present in English; only the second-language obligation is dropped.