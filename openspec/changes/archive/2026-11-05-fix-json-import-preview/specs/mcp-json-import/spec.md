# Spec Delta

## MODIFIED Requirements

### Requirement: Entry classification in the preview

Every entry SHALL be classified before anything is written: `new` when the target
scope does not have it, `update` when it exists and differs, `unchanged` when it
exists and is equal, `conflict` when the name is used in the other scope,
`invalid` when it fails validation, and, in the edit mode only, `delete` when it
exists in the scope but is absent from the document.

The comparison SHALL use the configuration each side would run: when the target
scope is a workspace, a stdio entry without `cwd` and one whose `cwd` is that
workspace's root SHALL be the same server, because the loader applies that default.
A derived default SHALL NOT be reported as a change.

For an `update` the preview SHALL list the fields that change with their current
and proposed values, and SHALL state when a stored OAuth session will be kept. It
SHALL show a `conflict` with the scope that owns the name and SHALL offer `keep`
and `replace` for it. The application SHALL NOT proceed while any entry is
invalid or any conflict is undecided.

#### Scenario: Mixed batch is classified

- **WHEN** a five-entry document holds two new names, one existing name with a different URL, one identical entry, and one name occupied by a global server
- **THEN** the preview shows two new, one update with its URL change, one unchanged, and one conflict naming the profile scope

#### Scenario: Unchanged entry causes nothing

- **WHEN** a document repeats a server's configuration exactly
- **THEN** the preview classifies it as unchanged and applying writes nothing for it

#### Scenario: A derived workspace default is not a change

- **WHEN** a workspace stdio entry declares no `cwd` and the document carries the workspace root as its `cwd`
- **THEN** the preview classifies the entry as unchanged and applying it writes nothing

#### Scenario: Conflict needs a decision

- **WHEN** a conflict remains undecided
- **THEN** the apply action is unavailable and states how many conflicts are pending

#### Scenario: Replace moves the entry

- **WHEN** the operator chooses replace for a name occupied by a workspace entry while importing into the profile scope
- **THEN** that workspace entry is removed from its file and the server is created in the profile scope

### Requirement: Dialog presentation and localization

The dialog SHALL present the document in a text field beside the preview, SHALL
offer a scope selector that starts on the scope the page is currently showing, and
SHALL lock the scope and the server name when it is opened from a server card.
Entries SHALL render as one compact line carrying the classification and the names
of the fields that change, and SHALL expand to the before/after values; entries
that block the application, invalid and undecided conflict, SHALL be expanded
already.

The preview SHALL refresh itself a short moment after the document or the target
scope changes, through the same request the manual preview uses, so the apply
action always describes the text on screen. A response that a newer request
superseded SHALL be ignored, and the automatic refresh SHALL NOT start while an
application is in flight. While no current plan exists the apply action SHALL
read as a plain apply with no count, never a zero count, and SHALL be
unavailable. The apply action SHALL state how many entries it will write once a
plan exists, and SHALL be unavailable while the plan is blocked. An edit SHALL
preserve a `keep`/`replace` choice already made for a name that is still in
conflict; changing the target scope SHALL clear them.

Every string the dialog introduces SHALL exist in both supported interface
languages and render in the selected language. Host-generated validation messages
keep the language the plugin produced.

#### Scenario: Scope starts on the page's scope

- **WHEN** the operator opens the dialog while a workspace is selected
- **THEN** the scope selector starts on that workspace and the preview classifies against it

#### Scenario: The preview follows an edit

- **WHEN** the operator changes the document and stops typing
- **THEN** the preview refreshes without pressing Preview and the apply action reflects the new plan

#### Scenario: No plan yet

- **WHEN** the dialog has no current plan, for example before the first response
- **THEN** the apply action reads as a plain apply with no count and is unavailable

#### Scenario: A superseded response is ignored

- **WHEN** an older preview response arrives after a newer one
- **THEN** the newer plan stays on screen

#### Scenario: An edit keeps a conflict choice

- **WHEN** the operator had chosen keep or replace for a conflicting name and then edits the document
- **THEN** that choice is still in effect after the automatic refresh

#### Scenario: Card entry locks scope and name

- **WHEN** the dialog is opened from a server card
- **THEN** the scope and the server name are fixed, and a document naming another server is rejected

#### Scenario: Blocked plan disables apply

- **WHEN** the plan holds an invalid entry
- **THEN** the apply action is unavailable and the dialog states that nothing will be written

#### Scenario: Both languages are complete

- **WHEN** the interface language is switched between the two supported languages
- **THEN** every label, classification, change description and action of the dialog is presented in the selected language with no untranslated key shown
