# Spec Delta

## MODIFIED Requirements

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

### Requirement: Effective redirect URI and registration state on the card

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

### Requirement: Localized labels for the new controls

Every user-visible string introduced by this change SHALL be present in both supported interface languages, and the page SHALL render them in the language selected in the application's language setting. This covers the redirect URI field and its help text, the automatic-mode and manual-Client-ID messages, the enable switch state labels, the card and workspace action labels, the global callback section and its mode, hostname, port and path labels, its status line, and its listener list. Host-generated diagnostic text (a listener error such as a busy port, or a provider message) stays in the language the plugin produced, like every other server-supplied diagnostic.

#### Scenario: Both languages are complete

- **WHEN** the interface language is switched between the two supported languages
- **THEN** the redirect URI label and help text, the callback section labels, the status line, the listener list, the pending-registration message and the diagnostics are all presented in the selected language, with no untranslated key shown

### Requirement: Card action area fits the card

The expanded server card SHALL present its actions as an enable switch whose adjacent label reports the state (`Enabled` or `Disabled`), an Edit action and a Delete action, and MUST NOT hide any of them behind a menu. When the server needs authentication, the status chip SHALL itself be the authentication action; a connected server SHALL show a plain status chip and no re-authentication control. The card SHALL start collapsed, and its expanded body SHALL contain only the attempt log and the action row. The action row MUST stay inside the card's bounds at every width the page produces, wrapping instead of overflowing. The same arrangement SHALL be used by a global server card and by a workspace server row. Delete SHALL keep the existing confirmation dialog.

#### Scenario: OAuth server with every action available

- **WHEN** a global OAuth server card is expanded in the page's layout
- **THEN** the switch, Edit and Delete are fully inside the card and no control extends past its edge, and while collapsed only the name and the status chip are shown

#### Scenario: Workspace card uses the same arrangement

- **WHEN** an OAuth server of a selected workspace renders
- **THEN** its actions are the switch, Edit and Delete, with no controls overflowing the row

#### Scenario: Menu opens, closes and confirms deletion

- **WHEN** the operator chooses Delete on a card
- **THEN** a confirmation dialog opens instead of deleting immediately, and cancelling it leaves the server in place

#### Scenario: Authenticate stays a direct action

- **WHEN** the card renders for an OAuth server that needs authentication, or that needs a broader scope
- **THEN** the status chip is the authentication action itself and carries the current status label

## ADDED Requirements

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
