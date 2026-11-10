# mcp-settings-ui Specification

## Purpose
Defines what the Settings → MCP page must show for a configured MCP server: the controls that edit and inspect its OAuth redirect URI, and an action area that stays inside the server card for every combination of available actions.

## Requirements

### Requirement: Redirect URL field in the OAuth section

For an HTTP server whose authentication mode is OAuth, the server form SHALL offer a redirect URI field that accepts a complete redirect URI. The field SHALL show the server's configured override and SHALL offer an explicit way to clear the override and return to the resolved default.

The placeholder SHALL be supplied by the plugin, because only it knows the effective default: the fully resolved URI when the global mode is fixed, and a value that names the automatic port as assigned at authentication when the global mode is automatic. While the field carries the stored value, the form SHALL also show the redirect URI that will actually be presented (or, in automatic mode, that the port is assigned at authentication together with the URI the last authorization used), a copy action for that value, whether the stored registration is pending an update, and any warning about the stored value. Saving a changed value SHALL state, in the form, that the next authentication registers the client again with the new URI and that the current session keeps working until then.

#### Scenario: Field shows the default when empty

- **WHEN** the operator opens the editor of an OAuth server with no override
- **THEN** the redirect URI field is empty and its placeholder carries the host-provided value for the current configuration

#### Scenario: Resolved placeholder in fixed mode

- **WHEN** the operator opens the editor of an OAuth server with no override while the global mode is fixed
- **THEN** the field is empty and its placeholder is the fully resolved callback URI for the configured host, port and path

#### Scenario: Automatic mode placeholder

- **WHEN** the operator opens the same editor while the global mode is automatic
- **THEN** the placeholder states that the port is assigned when authentication starts, and it is not presented as a final URI

#### Scenario: Saving an override explains the consequence

- **WHEN** the operator saves a changed redirect URI
- **THEN** the form states that the next authentication registers the client again with the new URI, and the save does not sign the server out

#### Scenario: Clearing restores the default

- **WHEN** the operator clears the field and saves
- **THEN** the override is removed and the server resolves its redirect URI from the global configuration again

#### Scenario: Resolved value, pending state and warnings live in the editor

- **WHEN** the operator opens the editor of an OAuth server whose field still carries the stored value
- **THEN** the form shows the effective redirect URI (or the automatic-port notice and the last used URI), a copy action, the pending-registration state and any stored-value warning

#### Scenario: Rejected value is reported in the form

- **WHEN** the operator saves a redirect URI the plugin rejects
- **THEN** the form shows the returned error message and the previously stored value remains in effect

### Requirement: Effective redirect URI and registration state in the editor

The redirect URI and its registration state SHALL be presented in the editor of an OAuth server, as reported by the plugin, and the server card SHALL NOT repeat them: the card's expanded body carries only the attempt log and the action row.

The editor SHALL show the redirect URI the server will present, together with a copy action that copies exactly that value. When the stored registration predates the configured URI, it SHALL state that the registration is pending an update without changing the connection status. When the global mode is automatic and the server has no override with an explicit port, no final URI exists before authentication: the editor SHALL say that the port is assigned at authentication, SHALL show the URI the last successful authorization used when one exists, and SHALL warn when a manually configured Client ID cannot work with a URI that changes per authentication.

#### Scenario: Effective URI is visible and copyable

- **WHEN** the operator opens the editor of an OAuth server while the global mode is fixed
- **THEN** the form shows the effective redirect URI and the copy action places that exact string on the clipboard

#### Scenario: Pending registration is flagged

- **WHEN** the effective redirect URI differs from the URI the current registration was made with
- **THEN** the editor shows that the registration is pending an update, without changing the connection status

#### Scenario: No flag once they match

- **WHEN** the registration was made with the effective redirect URI
- **THEN** no pending-registration message is shown

#### Scenario: Automatic mode names the missing port

- **WHEN** the editor renders for an OAuth server with no explicit port while the global mode is automatic
- **THEN** it states that the callback port is assigned when authentication starts, and it does not present a fabricated port as final

#### Scenario: Last used URI is shown

- **WHEN** an automatic-mode authorization has already completed for that server
- **THEN** the editor shows the redirect URI that authorization used, with the copy action

#### Scenario: Manual Client ID warns about a changing URI

- **WHEN** the server has a manually configured Client ID and resolves its callback to an automatic port
- **THEN** the editor warns that the URI changes per authentication and that a fixed callback configuration or a per-server override is required for a pre-registered client

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

### Requirement: Global callback settings in an Advanced section

The Settings → MCP page SHALL present the global callback configuration inside a collapsible **Advanced** section that is collapsed by default. While collapsed, the section header SHALL always show a status line containing the current mode, the number of active callback listeners, and a visible indicator when the last callback listener failure has not been cleared. Expanding the section SHALL reveal the mode selector, the loopback hostname, the port and the path, the active listeners with their address and pending-flow count, and the last listener error in full.

Saving SHALL validate the configuration and SHALL report a rejection inline in the section without persisting it.

#### Scenario: Status is visible while collapsed

- **WHEN** the operator opens Settings → MCP and leaves the Advanced section collapsed
- **THEN** the header shows the current mode and the number of active callback listeners

#### Scenario: A listener failure is noticeable without expanding

- **WHEN** the last callback listener attempt failed
- **THEN** the collapsed header shows an error indicator and expanding reveals the full message

#### Scenario: Fixed mode reveals the address fields

- **WHEN** the operator expands the section and selects fixed mode
- **THEN** hostname, port and path are editable and the port is required

#### Scenario: Automatic mode keeps the defaults

- **WHEN** the operator selects automatic mode
- **THEN** the section states the default hostname and path and does not require a port

#### Scenario: Active listeners are listed

- **WHEN** the operator expands the section while a callback listener is running
- **THEN** the listener's address and port are listed with the number of pending flows it is serving

#### Scenario: Rejected configuration is reported inline

- **WHEN** the operator saves a configuration the plugin rejects
- **THEN** the section shows the returned error and the stored configuration is unchanged

### Requirement: Callback diagnostics are surfaced where the action happened

A failure to start a callback listener, resolve a redirect URI, receive a valid callback or exchange the code SHALL be reported in three places: inline where the operator triggered authentication, in that server's attempt log, and as the card's error summary. A failure that belongs to the global configuration rather than to one server SHALL also appear in the Advanced section.

#### Scenario: Failure at authentication start

- **WHEN** starting authentication fails because the fixed callback port is occupied
- **THEN** the page shows the error next to the action that was taken

#### Scenario: Failure is recorded in the log

- **WHEN** any callback or listener failure happens for a server
- **THEN** that server's attempt log contains an entry describing it, with no secret value

#### Scenario: Global failure is visible globally

- **WHEN** the callback listener cannot be opened for a configuration reason
- **THEN** the Advanced section reports it in addition to the server-facing surfaces

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
