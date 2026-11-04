# Tasks

## 1. Configuration and resolution

- [x] 1.1 Add `redirectUrl` to the optional OAuth field parser and its apply step, accepting `host`, `host:port` or `scheme://host[:port]` and rejecting a value that carries a path, query, fragment or userinfo; verify with new unit cases in `test/redirect-url.test.js` that `localhost` and `localhost:8080` are accepted and `http://localhost:49593/mcp-manager/callback/x` is rejected with an error naming the fixed callback path.
- [x] 1.2 Enforce the host rule in the same parser: loopback (`localhost`, IPv4 loopback range, `::1`) or an origin listed in `config.publicOrigins`, with `https` on a loopback host rejected unless allowlisted; verify each rejection and each acceptance is covered by a unit case, including that a rejected value is not persisted by the global `PUT`.
- [x] 1.3 Implement the single redirect resolver (`redirectUriFor(server, requestOrigin)`): resolved override when configured, derived default otherwise, port inherited from the request origin when the override omits it, explicit port used verbatim, and `localhost` in the derived default replaced by `127.0.0.1`; verify with unit cases for every branch, and confirm the derived default still rejects a foreign request host.
- [x] 1.4 Replace the three call sites of the current URI builder (dynamic registration, authorization request, token exchange) with the resolver; verify with an end-to-end stub that the registration's `redirect_uris`, the authorization request's `redirect_uri` and the token request's `redirect_uri` are identical for an override of `localhost`.
- [x] 1.5 Carry the field through the credential plumbing: `applyOauthFields`, `sameServerConfig` and the external-edit adoption list; verify a hand-edited state file adds/updates the override and that a workspace hot reload notices a changed value.

## 2. Pinned attempt and callback route

- [x] 2.1 Record the resolved redirect URI in the pending authorization attempt when it starts and read it back in the token exchange instead of accepting an origin argument; verify with a test where the callback request is addressed to a different host and the exchange still sends the pinned URI.
- [x] 2.2 Remove the callback route's origin derivation and the now-unused non-strict origin branch (including the port-less fallback); verify the callback session tests still pass and that an expired or mismatched state makes no token request.
- [x] 2.3 Verify a manually configured Client ID still skips registration when an override is set: no registration request is issued and the configured URI is used in the authorization request.

## 3. Registration lifecycle

- [x] 3.1 Keep the field out of the global `PUT` identity comparison and out of any delete path for `server.oauth`, so saving an override leaves registration and tokens intact; verify that a save followed by a refresh succeeds using the pre-existing tokens.
- [x] 3.2 Verify the lazy re-registration path: after a save, the next authentication registers a new client with the new URI and the previous client's token pair is discarded, while a save alone never registers.
- [x] 3.3 Expose a pending-registration signal in the server view, true only when a stored registration exists and was made with a different URI than the effective one, and verify it flips after the next authentication.

## 4. Workspace entries

- [x] 4.1 Read and write `redirectUrl` in workspace entries (`normalizeWorkspaceServer`, `buildWorkspaceEntry`) and preserve it on an edit whose payload omits the field; verify with a workspace round-trip test and a partial-edit test.
- [x] 4.2 Verify a hand-edited workspace file that adds `redirectUrl` takes effect for that server's next authorization, and that an invalid value is ignored like the other optional OAuth fields.

## 5. API views

- [x] 5.1 Add the configured override, the effective redirect URI and the pending-registration signal to the global and workspace server views, computed with the origin of the request that asked for the list; verify both `GET /mcp-manager/api/servers` and `GET /mcp-manager/api/workspaces` return them for an OAuth server with and without an override.

## 6. Settings UI

- [x] 6.1 Add the Redirect URL field to the OAuth section of the server form, prefilled from the view, with the effective default as placeholder, an explicit clear-to-default affordance, and the save notice that the next authentication registers the client again; verify the field appears only for HTTP + OAuth and that a rejected value renders the API error next to the form.
- [x] 6.2 Show the effective redirect URI on the expanded OAuth card with a copy action that copies it verbatim, plus the pending-registration message when the view reports it; verify the clipboard payload equals the view value.
- [x] 6.3 Replace the card action cluster with the enable switch, the authenticate action and a `⋯` menu holding Edit and Delete, in both the global and the workspace card; verify the menu reports its expanded state, closes after choosing and on Escape in the client stub test, keeps the delete confirmation, and that no control overflows the card when every action is available (outside-click closing is implemented with a capture-phase document listener and is not covered by the stub harness).
- [x] 6.4 Add wrapping to the action containers and a minimum card width so the card grid collapses instead of overflowing; verify the narrowest layout the page produces keeps every control inside the card.
- [x] 6.5 Add every new string to both locale dictionaries and verify the client stub test renders the field label, menu items, copy action and pending message in both languages with no missing key.

## 7. Tests and verification

- [x] 7.1 Add `test/redirect-url.test.js` covering the resolution, validation, pinning, lifecycle and workspace requirements from the `oauth-redirect-url` spec; verify it passes on its own.
- [x] 7.2 Extend the stub client test to cover the field, the menu and the locale keys from the `mcp-settings-ui` spec; verify it passes on its own.
- [x] 7.3 Run the whole suite and confirm no existing OAuth, discovery, workspace or client test regressed, including the origin-allowlist and application-type cases.

## 8. Docs and release

- [x] 8.1 Update `README.md` and `README.zh-CN.md` with the redirect override: accepted forms, port inheritance, the loopback/allowlist rule, the proxy requirement for an explicit port, and the fact that changing it re-registers on the next authentication without signing out; verify both files describe the same behavior.
- [x] 8.2 Bump `package.json` to 0.17.0 and verify the README examples and version references agree.
- [ ] 8.3 Verify the change end to end in a disposable DSH profile with a scratch `HOME`/`USERPROFILE`/`DSH_HOME`: configure an OAuth server with a `localhost` override, complete a round trip against a loopback stub, confirm the copy action and the pending cue, and check the card action area on a narrow window; record the result.
- [ ] 8.4 Commit on the branch with the release notes and create the annotated `v0.17.0` tag on that commit, matching the existing tag style.
