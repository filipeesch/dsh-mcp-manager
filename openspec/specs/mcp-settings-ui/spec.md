# mcp-settings-ui Specification

## Purpose
Defines what the Settings → MCP page must show for a configured MCP server: the controls that edit and inspect its OAuth redirect URI, and an action area that stays inside the server card for every combination of available actions.

## Requirements

### Requirement: Redirect URL field in the OAuth section

For an HTTP server whose authentication mode is OAuth, the server form SHALL offer a redirect URL field. The field SHALL show the server's configured override, SHALL present the redirect URI that would be used without an override as its placeholder, and SHALL offer an explicit way to clear the override and return to that default. Saving a changed value SHALL state, in the form, that the next authentication registers the client again with the new URI.

#### Scenario: Field shows the default when empty

- **WHEN** the operator opens the editor of an OAuth server with no override
- **THEN** the redirect URL field is empty and its placeholder shows the effective default for the current GUI origin

#### Scenario: Saving an override explains the consequence

- **WHEN** the operator saves a changed redirect URL
- **THEN** the form states that the next authentication registers the client again with the new URI, and the save does not sign the server out

#### Scenario: Clearing restores the default

- **WHEN** the operator clears the field and saves
- **THEN** the override is removed and the server's redirect URI is the derived default again

#### Scenario: Rejected value is reported in the form

- **WHEN** the operator saves a redirect URL the plugin rejects
- **THEN** the form shows the returned error message and the previously stored value remains in effect

### Requirement: Effective redirect URI and registration state on the card

The expanded card of an OAuth server SHALL show the redirect URI that the server will actually present, as reported by the plugin, together with a copy action that copies exactly that value. When the stored registration predates the configured URI, the card SHALL state that the registration is pending an update.

#### Scenario: Effective URI is visible and copyable

- **WHEN** the operator expands an OAuth server's card
- **THEN** the card shows the effective redirect URI and the copy action places that exact string on the clipboard

#### Scenario: Pending registration is flagged

- **WHEN** the configured redirect URI differs from the URI the current registration was made with
- **THEN** the card shows that the registration is pending an update, without changing the connection status

#### Scenario: No flag once they match

- **WHEN** the registration was made with the configured URI
- **THEN** no pending-registration message is shown

### Requirement: Card action area fits the card

The server card SHALL present its actions as an enable switch, the authenticate action when the server uses OAuth, and a menu containing Edit and Delete. That action area MUST stay inside the card's bounds at every width the page itself produces, and no action may be clipped or overflow the card. The same arrangement SHALL be used by a global server card and by a workspace server card. The menu SHALL expose its expanded state to assistive technology, SHALL close when the operator clicks outside it or presses Escape, and Delete SHALL keep the existing confirmation dialog.

#### Scenario: OAuth server with every action available

- **WHEN** a global OAuth server card renders in the page's two-column card layout with authentication, editing and deletion all available
- **THEN** the switch, the authenticate action and the menu are fully inside the card and no control extends past its edge

#### Scenario: Workspace card uses the same arrangement

- **WHEN** an OAuth server of a selected workspace renders
- **THEN** its actions are the switch, the authenticate action and the same menu, with no controls overflowing the card

#### Scenario: Menu opens, closes and confirms deletion

- **WHEN** the operator opens the menu and then either clicks outside it or presses Escape
- **THEN** the menu closes, its expanded state is reported while open, and choosing Delete opens the confirmation dialog instead of deleting immediately

#### Scenario: Authenticate stays a direct action

- **WHEN** the card renders for an OAuth server that needs authentication, or that needs a broader scope
- **THEN** the authenticate action is visible without opening the menu and carries its current label

### Requirement: Localized labels for the new controls

Every user-visible string introduced by this change SHALL be present in both supported interface languages, and the page SHALL render them in the language selected in the application's language setting.

#### Scenario: Both languages are complete

- **WHEN** the interface language is switched between the two supported languages
- **THEN** the redirect URL label and help text, the menu items, the copy action and the pending-registration message are all presented in the selected language, with no untranslated key shown
