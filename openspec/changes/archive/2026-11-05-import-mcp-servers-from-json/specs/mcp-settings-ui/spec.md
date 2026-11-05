# Spec Delta

## ADDED Requirements

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

Every label the menu introduces SHALL exist in both supported interface languages
and SHALL render in the language selected in the application's language setting.

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

- **WHEN** the interface language is switched between the two supported languages
- **THEN** the two menu entries and the overflow action's accessible label are presented in the selected language with no untranslated key shown

### Requirement: Edit as JSON action on the server card

The expanded server card of both tiers SHALL present an **Edit as JSON** action in
the visible action row, next to the Edit action and outside the overflow menu, in
addition to the actions that row already carries. The action SHALL open the JSON
dialog locked to that server: the document is seeded with that server's current
entry, the scope is the scope the card belongs to, and a document naming any other
server SHALL be rejected in the preview. Opening it SHALL NOT disturb the server's
connection or its stored session, and the action SHALL remain available for a
disabled server.

The action's label SHALL exist in both supported interface languages and SHALL
render in the language selected in the application's language setting.

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
