# Decision gaps and retained capabilities

This records differences found while reconciling the catalogue with current source and
[DECISIONS.md](../DECISIONS.md). It does not change the agreed decisions or authorize product
changes. Source inspection establishes the controls that exist; it is not runtime verification
of every implementation guarantee.

## Differences requiring reconciliation

| ID     | Agreed target                                                                                                                                       | Current implementation                                                                                                                                                                                                                                                                                                                                           | Catalogue treatment                                                                                                                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GAP-01 | Editors and above may change company name, time zone and week start: [Data and tenancy](../DECISIONS.md#data-and-tenancy), configuration paragraph. | [Company details](../apps/frontend/src/components/settings/SettingsAccountSections.tsx#L20) displays all three as read-only values. [Frozen-field policy](../apps/backend/app/services/planning/entity_policy.ts#L51) and its [enforcement](../apps/backend/app/services/planning/entity_policy.ts#L217) refuse changing an established time zone or week start. | Describe current read-only details and setup fields accurately; retain the target as unavailable. Company-name editing has no ordinary Settings control. Decide whether to restore editing or amend the target; this refresh does neither. |

## Deliberately retained features

These are availability records, not automatically defects or commitments to bring a feature back.
The matrix keeps every historical story discoverable by status.

| Capability                                                | Availability | Evidence and treatment                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project phases and assigning an activity to a phase       | Hidden       | The current [project form](../apps/frontend/src/components/projects/ProjectForm.tsx) has no phase-management entry; the [activity form](../apps/frontend/src/components/activities/ActivityForm.tsx) preserves phase attribution but renders no phase picker. Keep the existing project and activity stories. The decision permits phase references; it does not promise a current phase editor. |
| Jump to date                                              | Hidden       | [DECISIONS.md](../DECISIONS.md#scheduling-invariants) explicitly hides this picker while retaining its code. Keep the toolbar story with historical controls labelled unavailable.                                                                                                                                                                                                               |
| Company picker, additional company creation and switching | Demo         | The [company picker](../apps/frontend/src/components/accounts/AccountPicker.tsx) remains in the temporary demo. Production has one company and no ordinary switcher or additional-company action. Keep this distinction in the navigation stories.                                                                                                                                               |

## Retained recovery screens without current triggers

Source review found no current producers for three legacy error-state flags:
`connectionError`, `activeAccountLoadFailed` and `loadError`. They are initialized false/null in
[runtimeSlice](../apps/frontend/src/store/slices/runtimeSlice.ts), and
[AppEntryGate](../apps/frontend/src/components/AppEntryGate.tsx) only consumes them.
The named setters have no current application callers; the account-load marker is cleared but
never assigned a failed company. The connection, company-load and browser-storage recovery
stories remain, with status **Hidden** and an Entry line stating there is no current entry. Their
retained components are not evidence of reachable user journeys. Current planning-error notices
and session-verification recovery remain separately documented as available.

## Source capabilities without an ordinary UI

- **Member sign-in tracking:** the server route and mutation support recording sign-ins, but
  [MembersSection](../apps/frontend/src/components/team/MembersSection.tsx) renders neither its
  toggle nor its column; the [existing visibility test](../apps/frontend/src/components/team/MembersSection.lifecycle.test.tsx#L536)
  explicitly expects them to be hidden. The retained team story is Hidden, not a claim of a
  current menu action.
- **Open self-registration:** [auth routes](../apps/backend/start/auth_routes.ts#L11) expose
  password signup under the configured admission policy, but the current
  [sign-in screen](../apps/frontend/src/auth/LoginScreen.tsx) has no registration form or link.
  The available account-creation journey is the emailed invitation. The agreed signup policy
  is enforced on the server; a self-service registration entry is a UI availability gap,
  not evidence that signup bypasses the policy. No new entry point is introduced here.
- **Admission reversal:** the [approval panel](../apps/frontend/src/components/team/AdmissionRequestsPanel.tsx)
  offers Approve and Decline for the applicable states, with no revocation control. Stories
  describe those rendered actions rather than inventing a button from the policy's revoked state.

## Coverage omissions addressed

The **Catalogue** column in [COVERAGE.md](COVERAGE.md) marks every added story **New**.
It distinguishes newly documented functionality from changes to the product itself. Existing
stories retain their filenames and identifiers, even when their title is corrected to match the
current archive/restore vocabulary.

## Evidence limits

- The review covers user-facing capabilities and the agreed product rules relevant to their
  availability, roles and fields. It is not a fresh audit of every security or transaction invariant.
- Readable source and existing tests are evidence for the catalogue; linked tests are not claims
  of new runtime execution. Validation for this change checks document structure, links,
  identifiers and matrix/index consistency.
- Operator installation remains a separate context. The catalogue does not expand product scope
  to include hosting controls in the application.
