# mcp-json-import Specification

## Purpose
Lets an operator configure several MCP servers at once by pasting a `mcpServers`
document, previewing exactly what it would change, and applying it atomically in
either the profile scope or one workspace scope.

## Requirements

### Requirement: Accepted document shape

The import SHALL accept a JSON object whose `mcpServers` member maps a server
name to an entry, and SHALL read only the fields the workspace declaration already
defines: `type`, `url`, `authMode`, `tokenEnv`, `headers`, `headerEnv`,
`clientId`, `clientSecretEnv`, `clientName`, `scope`, `redirectUrl`, `timeout`,
`command`, `args`, `env`, and `cwd`. The same document SHALL be accepted in the
profile scope and in a workspace scope.

A server name SHALL be 1-32 characters of `[A-Za-z0-9_-]`. A document that is not
a JSON object, that has no `mcpServers` object, or whose names collide after
trimming SHALL be rejected as a whole, with a message naming every offending
entry.

#### Scenario: Several servers pasted at once

- **WHEN** the operator pastes a document with five entries and applies it to the profile scope
- **THEN** five servers exist with those configurations, and no other server changes

#### Scenario: One entry pasted for a single server

- **WHEN** the operator opens the JSON dialog from a server card and submits a document holding only that server's entry
- **THEN** only that server is updated

#### Scenario: Envelope rejected

- **WHEN** the pasted text is a bare entry without `mcpServers`, or a JSON array
- **THEN** the batch is rejected before any write and the message names the missing envelope

#### Scenario: Duplicate names after trimming

- **WHEN** the document holds both `"github"` and `" github "` as keys
- **THEN** the batch is rejected and the message names both keys

### Requirement: Transport inference

When an entry omits `type`, the import SHALL treat it as a stdio server if it
carries a non-empty `command` and no `url`, and as an HTTP server otherwise.
`type: "sse"` SHALL be accepted and treated as `http`. This inference SHALL apply
to the import path only: reading an existing workspace declaration keeps its
current rule, so a hand-written file without `type` is not reinterpreted.

#### Scenario: Claude-style stdio entry

- **WHEN** an entry is `{ "command": "npx", "args": ["-y", "@mcp/fs", "."] }`
- **THEN** the preview classifies it as a new stdio server and applying it creates a local process server

#### Scenario: sse alias

- **WHEN** an entry declares `"type": "sse"` with a `url`
- **THEN** the preview presents it as an HTTP server and states that the declared transport was read as HTTP

#### Scenario: Neither command nor url

- **WHEN** an entry has neither a `command` nor a `url`
- **THEN** that entry is invalid, its message names the missing field, and the batch is not written

### Requirement: Entry classification in the preview

Every entry SHALL be classified before anything is written: `new` when the target
scope does not have it, `update` when it exists and differs, `unchanged` when it
exists and is equal, `conflict` when the name is used in the other scope,
`invalid` when it fails validation, and, in the edit mode only, `delete` when it
exists in the scope but is absent from the document.

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

#### Scenario: Conflict needs a decision

- **WHEN** a conflict remains undecided
- **THEN** the apply action is unavailable and states how many conflicts are pending

#### Scenario: Replace moves the entry

- **WHEN** the operator chooses replace for a name occupied by a workspace entry while importing into the profile scope
- **THEN** that workspace entry is removed from its file and the server is created in the profile scope

### Requirement: Import is additive and edit is declarative

An **import** SHALL create and update only: an entry absent from the document
SHALL NOT change the target scope, and no server SHALL be removed. An **edit**
SHALL treat the document as the complete target scope: it SHALL create, update,
and delete, and an entry absent from the document SHALL be removed.

A deletion SHALL be listed in the preview and confirmed before it is applied, and
it SHALL behave like the page's delete action: the server stops, its stored OAuth
session is dropped, and its name is cleared from the workspace off lists when no
profile server owns it.

#### Scenario: Absent entry survives an import

- **WHEN** the operator imports a document that does not mention an existing server
- **THEN** that server keeps its configuration, its connection, and its stored session

#### Scenario: Absent entry is deleted by an edit

- **WHEN** the operator opens edit from the current scope, removes one entry, and applies
- **THEN** the preview lists that entry as a deletion and, after confirmation, the server is removed

#### Scenario: Empty document in edit mode deletes the scope

- **WHEN** the edit document is `{ "mcpServers": {} }` for a scope holding three servers
- **THEN** the preview lists three deletions and states that count before the operator can confirm

### Requirement: Atomic application and per-entry errors

The batch SHALL be validated completely before any file is written. If any entry
is invalid, the whole batch SHALL be abandoned: no server created, updated, or
deleted, no stored session dropped, and no connection changed. Every invalid entry
SHALL be reported with its name, the offending field, and a message, and all of
them SHALL appear in the same response.

#### Scenario: One invalid entry aborts the batch

- **WHEN** a twenty-entry document has one entry whose `url` is not an HTTP URL
- **THEN** nothing is written, and the message names that entry and its `url` field

#### Scenario: Several invalid entries are reported together

- **WHEN** two entries have an invalid `timeout` and an invalid `clientSecretEnv`
- **THEN** both are reported with their own name and field in one response

#### Scenario: A valid batch applies completely

- **WHEN** every entry is valid
- **THEN** the whole batch is applied, and a failure to persist leaves the scope as it was

### Requirement: Merge and preservation rules

An updated entry SHALL replace its structural fields — transport, `url`,
`command`, `args`, `env`, `cwd`, `authMode`, `tokenEnv`, `headers`, `headerEnv`,
`timeout` — and SHALL inherit the stored OAuth credential fields (`clientId`,
`clientSecretEnv`, `clientName`, `scope`, `redirectUrl`) when the document omits
them; an explicit empty string SHALL clear them. An omitted or empty `tokenEnv`
SHALL inherit the stored environment-variable name.

Keys the schema does not define SHALL be discarded, including credential-shaped
keys such as `oauth`, `tokens`, and `staticToken`, so a document can never
introduce a token or a stored secret. Keys the plugin does not know at the top of a
workspace file (`exclude`, `disabled`, a custom key) SHALL be preserved.

#### Scenario: URL-only update keeps the client identity

- **WHEN** an update supplies a new `url` and omits `clientId` and `clientName`
- **THEN** the stored client identity remains and the server is not signed out

#### Scenario: An explicit empty value clears a field

- **WHEN** an update supplies `"clientId": ""`
- **THEN** the stored manual client id is removed

#### Scenario: Credential-shaped keys are discarded

- **WHEN** a pasted entry carries `"oauth": { "tokens": { … } }` and `"staticToken": "…"`
- **THEN** neither reaches the target configuration and no token is stored

#### Scenario: Workspace file keeps its own keys

- **WHEN** an import writes into a workspace whose file holds `exclude`, a custom key, and other servers
- **THEN** those keys and servers are unchanged

#### Scenario: Environment-variable name is inherited

- **WHEN** a static-auth update omits `tokenEnv`
- **THEN** the stored environment-variable name remains

### Requirement: OAuth identity and token survival

A server's stored OAuth client registration and tokens SHALL be retained when the
application leaves the client identity (`clientId`, `clientSecretEnv`, and the
dynamic `clientName`) and the issuer of the endpoint unchanged, so the server keeps
working without a new authorization. The stored session SHALL be dropped when any
part of that identity changes, or when the endpoint moves to another issuer. When a
replace moves a server between scopes with the identity and issuer unchanged, the
stored session SHALL move with it.

#### Scenario: A partial update keeps the session

- **WHEN** an update changes only the URL's path on the same issuer and keeps the client identity
- **THEN** the stored tokens and registration remain and the server does not require re-authentication

#### Scenario: A changed client id drops the session

- **WHEN** an update supplies a different `clientId`
- **THEN** the stored registration and tokens are dropped and the server needs a new authorization

#### Scenario: Replace migrates the session

- **WHEN** a workspace entry is replaced into the profile scope with the same client identity and issuer
- **THEN** its stored session moves to the profile scope and the server keeps working

#### Scenario: Replace without identity drops the session

- **WHEN** the same replace is made with a different `clientName`
- **THEN** the stored session is not carried over and the new server starts unauthenticated

### Requirement: No hidden state changes

Applying a document SHALL NOT enable or disable a server, SHALL NOT start an
authorization, and SHALL NOT disconnect a server whose configuration did not
change. A server that was disabled before the application SHALL remain disabled
and SHALL NOT connect afterwards, even when its configuration changed. A server
whose configuration changed SHALL reconnect with the new configuration, and a
server created by the document SHALL be connected like one created through the
form.

#### Scenario: Disabled server stays disabled

- **WHEN** the document updates a server that is disabled in the target scope
- **THEN** the configuration is persisted, the server remains disabled, and no connection is opened

#### Scenario: Unchanged server keeps its connection

- **WHEN** the batch holds only unchanged entries
- **THEN** no connection is closed or reopened

#### Scenario: New server connects

- **WHEN** the batch creates a server whose credentials are available
- **THEN** it connects and registers its tools without a manual reconnect

#### Scenario: No authorization is started

- **WHEN** a document creates an OAuth server
- **THEN** it is persisted in the needs-auth state and no browser authorization is opened

### Requirement: One validated plan for preview and application

A single request contract SHALL serve both the preview and the application. A
preview SHALL validate and classify the document and write nothing. An application
SHALL re-validate the submitted document from scratch instead of trusting a
previously returned plan, and SHALL return the classification it applied. A batch
SHALL be limited to 200 entries and 1 MiB, and a larger batch SHALL be rejected
before validation with a message stating the limit.

#### Scenario: Preview writes nothing

- **WHEN** a preview request is made for a valid document
- **THEN** the scope's configuration and stored sessions are unchanged

#### Scenario: Application re-derives the plan

- **WHEN** the scope changed between a preview and the application of the same document
- **THEN** the application classifies the document against the current scope and reports that classification

#### Scenario: Oversized batch is rejected

- **WHEN** a document holds 201 entries or exceeds 1 MiB
- **THEN** it is rejected with a message stating the limit and nothing is written

### Requirement: Dialog presentation and localization

The dialog SHALL present the document in a text field beside the preview, SHALL
offer a scope selector that starts on the scope the page is currently showing, and
SHALL lock the scope and the server name when it is opened from a server card.
Entries SHALL render as one compact line carrying the classification and the names
of the fields that change, and SHALL expand to the before/after values; entries
that block the application, invalid and undecided conflict, SHALL be expanded
already. The apply action SHALL state how many entries it will write and SHALL be
unavailable while the plan is blocked.

Every string the dialog introduces SHALL exist in both supported interface
languages and render in the selected language. Host-generated validation messages
keep the language the plugin produced.

#### Scenario: Scope starts on the page's scope

- **WHEN** the operator opens the dialog while a workspace is selected
- **THEN** the scope selector starts on that workspace and the preview classifies against it

#### Scenario: Card entry locks scope and name

- **WHEN** the dialog is opened from a server card
- **THEN** the scope and the server name are fixed, and a document naming another server is rejected

#### Scenario: Blocked plan disables apply

- **WHEN** the plan holds an invalid entry
- **THEN** the apply action is unavailable and the dialog states that nothing will be written

#### Scenario: Both languages are complete

- **WHEN** the interface language is switched between the two supported languages
- **THEN** every label, classification, change description and action of the dialog is presented in the selected language with no untranslated key shown
