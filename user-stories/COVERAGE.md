# Capability coverage matrix

This matrix maps user actions to stories across the application, including capabilities that
previously had no standalone story. Read the linked story for form fields, access conditions,
entry points and implementation sources. **New** means added to the catalogue in this refresh,
not newly implemented functionality.

The inventory covers ordinary pages and their forms, lists and menus; schedule gestures,
details, navigation and filtering; public and limited account states; membership and security;
settings, data actions and recovery. Demo-only and operator actions are labelled separately.
Hidden and removed entries preserve the reason for the feature without implying it is available.

Reviewed from source against the branch baseline and DECISIONS.md. This is a product capability
inventory, not an assertion that every runtime, security or error-path test has passed. See
[decision gaps](GAPS.md) for differences, and [reference](REFERENCE.md) for source and screen maps.

## Accessibility

| Story                                                           | Action                                                 | Access                                                            | Status  | Catalogue |
| --------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- | ------- | --------- |
| [US-KBD-01](accessibility/US-KBD-01-bar-keyboard.md)            | Operate schedule allocations by keyboard               | Owner, Admin, Editor; Viewer is read-only                         | Current | Existing  |
| [US-KBD-02](accessibility/US-KBD-02-modal-keyboard.md)          | Use dialogs with a keyboard                            | Owner, Admin, Editor, Viewer; actions remain role-gated           | Current | Existing  |
| [US-KBD-03](accessibility/US-KBD-03-grid-semantics.md)          | Understand the schedule grid with assistive technology | Owner, Admin, Editor, Viewer                                      | Current | Existing  |
| [US-KBD-04](accessibility/US-KBD-04-axe-clean.md)               | Keep key screens accessible                            | Owner, Admin, Editor, Viewer                                      | Current | Existing  |
| [US-KBD-05](accessibility/US-KBD-05-field-error-association.md) | Associate validation errors with fields                | Owner, Admin, Editor; forms accessible to Viewer remain read-only | Current | Existing  |
| [US-KBD-06](accessibility/US-KBD-06-compact-input-modals.md)    | Scan management forms at different widths              | Owner, Admin, Editor; visibility and writes are role-gated        | Current | Existing  |

## Account

| Story                                                          | Action                               | Access                                                                                                                   | Status  | Catalogue |
| -------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| [US-ACCOUNT-01](account/US-ACCOUNT-01-identity.md)             | Check my signed-in identity          | Any signed-in person; demo mode shows its demo identity.                                                                 | Current | New       |
| [US-ACCOUNT-02](account/US-ACCOUNT-02-password-change.md)      | Change my password                   | Any signed-in person.                                                                                                    | Current | New       |
| [US-ACCOUNT-03](account/US-ACCOUNT-03-password-reset.md)       | Recover a forgotten password         | Anyone can request a link; a person with a valid reset link can set a new password.                                      | Current | New       |
| [US-ACCOUNT-04](account/US-ACCOUNT-04-sign-out.md)             | Sign out of this browser             | Any signed-in person.                                                                                                    | Current | New       |
| [US-ACCOUNT-05](account/US-ACCOUNT-05-delete-account.md)       | Delete my account                    | Any signed-in person; an Owner must transfer ownership first.                                                            | Current | New       |
| [US-ACCOUNT-06](account/US-ACCOUNT-06-register.md)             | Create my account from an invitation | Person with a valid invitation for an address that does not already have an account.                                     | Current | New       |
| [US-ACCOUNT-07](account/US-ACCOUNT-07-confirm-email.md)        | Confirm my email address             | Signed-in person at the email-confirmation gate; a valid emailed confirmation link is required to complete confirmation. | Current | New       |
| [US-ACCOUNT-08](account/US-ACCOUNT-08-session-verification.md) | Retry session verification           | Person whose session verification failed.                                                                                | Current | New       |
| [US-ACCOUNT-09](account/US-ACCOUNT-09-limited-access.md)       | Resolve my limited account access    | Signed-in person at an admission or membership gate.                                                                     | Current | New       |

## Activities

| Story                                                        | Action                                                             | Access                                  | Status  | Catalogue |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------- | ------- | --------- |
| [US-ACT-01](activities/US-ACT-01-add-activity.md)            | Add an activity (internal, all-projects, or project-specific)      | Editor and above (Editor, Admin, Owner) | Current | Existing  |
| [US-ACT-02](activities/US-ACT-02-activity-phase.md)          | Assign an activity to a phase (optional; resets on project change) | Editor and above (Editor, Admin, Owner) | Hidden  | Existing  |
| [US-ACT-03](activities/US-ACT-03-edit-activity.md)           | Edit an activity                                                   | Editor and above (Editor, Admin, Owner) | Current | Existing  |
| [US-ACT-04](activities/US-ACT-04-delete-activity-cascade.md) | Archive an activity (allocations hidden)                           | Editor and above (Editor, Admin, Owner) | Current | Existing  |
| [US-ACT-05](activities/US-ACT-05-restore-activity.md)        | Restore an archived activity                                       | Editor and above (Editor, Admin, Owner) | Current | New       |

## Allocation

| Story                                                          | Action                                         | Access                 | Status  | Catalogue |
| -------------------------------------------------------------- | ---------------------------------------------- | ---------------------- | ------- | --------- |
| [US-ALL-01](allocation/US-ALL-01-create.md)                    | Create an allocation via the modal             | Editor, Admin or Owner | Current | Existing  |
| [US-ALL-02](allocation/US-ALL-02-edit.md)                      | Edit an existing allocation                    | Editor, Admin or Owner | Current | Existing  |
| [US-ALL-03](allocation/US-ALL-03-duplicate.md)                 | Duplicate an allocation                        | Editor, Admin or Owner | Current | Existing  |
| [US-ALL-04](allocation/US-ALL-04-delete.md)                    | Delete an allocation                           | Editor, Admin or Owner | Current | Existing  |
| [US-ALL-05](allocation/US-ALL-05-add-activity-inline.md)       | Add a new activity inline from the modal       | Editor, Admin or Owner | Current | Existing  |
| [US-ALL-06](allocation/US-ALL-06-change-assignee.md)           | Change an allocation's assignee                | Editor, Admin or Owner | Current | Existing  |
| [US-ALL-07](allocation/US-ALL-07-placeholder-locks-project.md) | Placeholder assignee locks the project         | Editor, Admin or Owner | Current | Existing  |
| [US-ALL-08](allocation/US-ALL-08-validation.md)                | The modal rejects bad input                    | Editor, Admin or Owner | Current | Existing  |
| [US-ALL-09](allocation/US-ALL-09-repeat-creation.md)           | Create repeating weekly or monthly allocations | Editor, Admin or Owner | Current | Existing  |
| [US-ALL-10](allocation/US-ALL-10-task-field.md)                | Add an optional task to an allocation          | Editor, Admin or Owner | Current | Existing  |
| [US-ALL-11](allocation/US-ALL-11-cancel-allocation-form.md)    | Cancel allocation create or edit               | Editor, Admin or Owner | Current | New       |

## Capacity Overview

| Story                                                                 | Action                                       | Access                                                                                       | Status  | Catalogue |
| --------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- | ------- | --------- |
| [US-CAP-01](capacity-overview/US-CAP-01-review-four-week-capacity.md) | Review four-, eight- or twelve-week capacity | Owner and Admin by default; Overview access can add Editors or Everyone; anyone in demo mode | Current | Existing  |

## Clients

| Story                                                      | Action                                 | Access                                                                                        | Status  | Catalogue |
| ---------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- | ------- | --------- |
| [US-CLI-01](clients/US-CLI-01-add-client.md)               | Add a client                           | Editor and above (Editor, Admin, Owner)                                                       | Current | Existing  |
| [US-CLI-02](clients/US-CLI-02-edit-client.md)              | Edit a client                          | Editor and above (Editor, Admin, Owner)                                                       | Current | Existing  |
| [US-CLI-03](clients/US-CLI-03-archive-client.md)           | Archive a client                       | Editor and above (Editor, Admin, Owner)                                                       | Current | Existing  |
| [US-CLI-04](clients/US-CLI-04-internal-client.md)          | The built-in "Internal" client         | Editors and above manage projects and activities; all roles can view and filter Internal work | Current | Existing  |
| [US-CLI-05](clients/US-CLI-05-private-client-code-name.md) | Mark a client private with a code name | Editor and above for ordinary fields; Owner only for privacy and code-name fields             | Current | Existing  |
| [US-CLI-06](clients/US-CLI-06-restore-client.md)           | Restore an archived client             | Editor and above (Editor, Admin, Owner)                                                       | Current | New       |

## Data

| Story                                                   | Action                                    | Access                                        | Status  | Catalogue |
| ------------------------------------------------------- | ----------------------------------------- | --------------------------------------------- | ------- | --------- |
| [US-DAT-01](data/US-DAT-01-export-json.md)              | Export company data                       | Owner, Admin, Editor, Viewer                  | Current | Existing  |
| [US-DAT-02](data/US-DAT-02-import-json.md)              | Preview and replace company data          | Owner on server; demo users in temporary demo | Current | Existing  |
| [US-DAT-03](data/US-DAT-03-undo-import.md)              | Keep imported data outside undo history   | Owner on server; demo users in temporary demo | Current | Existing  |
| [US-DAT-04](data/US-DAT-04-reject-non-capacitylens.md)  | Reject invalid import files               | Owner on server; demo users in temporary demo | Current | Existing  |
| [US-DAT-05](data/US-DAT-05-persist-reload.md)           | Keep server changes after reload          | Any authorized company member                 | Current | Existing  |
| [US-DAT-06](data/US-DAT-06-seed-and-no-reseed.md)       | Explore temporary demo data               | Demo user                                     | Demo    | Existing  |
| [US-DAT-07](data/US-DAT-07-private-name-portability.md) | Preserve private names safely in transfer | Owner for import; role-tiered export          | Current | Existing  |
| [US-DAT-08](data/US-DAT-08-preview-exact-import.md)     | Confirm the exact import operation        | Owner                                         | Current | New       |

## Disciplines

| Story                                                            | Action                                                 | Access                                  | Status  | Catalogue |
| ---------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------- | ------- | --------- |
| [US-DIS-01](disciplines/US-DIS-01-add-discipline.md)             | Add a discipline                                       | Editor and above (Editor, Admin, Owner) | Current | Existing  |
| [US-DIS-02](disciplines/US-DIS-02-edit-discipline.md)            | Edit a discipline                                      | Editor and above (Editor, Admin, Owner) | Current | Existing  |
| [US-DIS-03](disciplines/US-DIS-03-delete-discipline-ungroups.md) | Delete a discipline (resources ungrouped, not deleted) | Editor and above (Editor, Admin, Owner) | Current | Existing  |
| [US-DIS-04](disciplines/US-DIS-04-sort-order.md)                 | Disciplines use a predictable order on each surface    | Viewer, Editor, Admin or Owner          | Current | Existing  |

## Filters

| Story                                               | Action                                 | Access                         | Status  | Catalogue |
| --------------------------------------------------- | -------------------------------------- | ------------------------------ | ------- | --------- |
| [US-FIL-01](filters/US-FIL-01-search.md)            | Search resources by name or role       | Viewer, Editor, Admin or Owner | Current | Existing  |
| [US-FIL-02](filters/US-FIL-02-filter-discipline.md) | Filter by discipline                   | Viewer, Editor, Admin or Owner | Current | Existing  |
| [US-FIL-03](filters/US-FIL-03-filter-client.md)     | Filter by client                       | Viewer, Editor, Admin or Owner | Current | Existing  |
| [US-FIL-04](filters/US-FIL-04-filter-project.md)    | Filter by project                      | Viewer, Editor, Admin or Owner | Current | Existing  |
| [US-FIL-05](filters/US-FIL-05-hide-tentative.md)    | Hide tentative allocations             | Viewer, Editor, Admin or Owner | Current | Existing  |
| [US-FIL-06](filters/US-FIL-06-clear-filters.md)     | Clear all filters at once              | Viewer, Editor, Admin or Owner | Current | Existing  |
| [US-FIL-07](filters/US-FIL-07-empty-state.md)       | Empty state when no resource matches   | Viewer, Editor, Admin or Owner | Current | Existing  |
| [US-FIL-08](filters/US-FIL-08-filter-activity.md)   | Filter by activity (the activity lens) | Viewer, Editor, Admin or Owner | Current | Existing  |
| [US-FIL-09](filters/US-FIL-09-toggle-filter-row.md) | Show or hide the schedule filters      | Viewer, Editor, Admin or Owner | Current | Existing  |
| [US-FIL-10](filters/US-FIL-10-show-unallocated.md)  | Show resources without matching work   | Viewer, Editor, Admin or Owner | Current | New       |

## Installation

| Story                                                     | Action                                  | Access                                                          | Status   | Catalogue |
| --------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------- | -------- | --------- |
| [US-INS-01](installation/US-INS-01-install-one-agency.md) | Install and operate one agency instance | Hosting operator; company Owner completes browser company setup | Operator | Existing  |

## Navigation

| Story                                                          | Action                                           | Access                                                                                                      | Status  | Catalogue |
| -------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------- | --------- |
| [US-NAV-01](navigation/US-NAV-01-navigate-sections.md)         | Navigate permitted sections                      | Owner, Admin, Editor, Viewer; section visibility and write controls follow role policy.                     | Current | Existing  |
| [US-NAV-02](navigation/US-NAV-02-active-section-indicated.md)  | See the active section                           | Owner, Admin, Editor, Viewer                                                                                | Current | Existing  |
| [US-NAV-03](navigation/US-NAV-03-loading-gate.md)              | Wait for company data                            | Owner, Admin, Editor, Viewer                                                                                | Current | Existing  |
| [US-NAV-04](navigation/US-NAV-04-persist-error-banner.md)      | See planning read and save failures              | Owner, Admin, Editor, Viewer                                                                                | Current | Existing  |
| [US-NAV-05](navigation/US-NAV-05-toast-autodismiss.md)         | Read and dismiss action notices                  | Owner, Admin, Editor, Viewer                                                                                | Current | Existing  |
| [US-NAV-06](navigation/US-NAV-06-dark-mode.md)                 | Choose appearance                                | Owner, Admin, Editor, Viewer                                                                                | Current | Existing  |
| [US-NAV-07](navigation/US-NAV-07-error-boundary.md)            | Recover from a rendering error                   | Owner, Admin, Editor, Viewer                                                                                | Current | Existing  |
| [US-NAV-08](navigation/US-NAV-08-command-palette.md)           | Jump with the command palette                    | Owner, Admin, Editor, Viewer; results respect destination access                                            | Current | Existing  |
| [US-NAV-09](navigation/US-NAV-09-mobile-affordances.md)        | Use navigation on a narrow screen                | Owner, Admin, Editor, Viewer                                                                                | Current | Existing  |
| [US-NAV-10](navigation/US-NAV-10-login-screen.md)              | Enter the persisted application                  | Unauthenticated visitors; admitted users can sign in                                                        | Current | Existing  |
| [US-NAV-12](navigation/US-NAV-12-product-orientation.md)       | Understand the product at entry                  | Owner, Admin, Editor, Viewer                                                                                | Current | Existing  |
| [US-NAV-13](navigation/US-NAV-13-getting-started.md)           | Track first schedule progress                    | Owner, Admin, Editor; demo/local mode has no membership role; Viewer does not see the Getting Started panel | Current | Existing  |
| [US-NAV-14](navigation/US-NAV-14-company-picker-onboarding.md) | Set up and open the installation company         | Initial admitted identity only during empty-install setup; subsequent entry requires membership             | Current | Existing  |
| [US-NAV-15](navigation/US-NAV-15-semantic-colour-language.md)  | Recognize action meaning and product identity    | Owner, Admin, Editor, Viewer                                                                                | Current | Existing  |
| [US-NAV-16](navigation/US-NAV-16-help-and-role-tour.md)        | Find help and a role-based tour                  | Owner, Admin, Editor, Viewer                                                                                | Current | Existing  |
| [US-NAV-17](navigation/US-NAV-17-demo-mode.md)                 | Create, switch between, and reset demo companies | Anyone using the demo build; no account role applies.                                                       | Demo    | New       |
| [US-NAV-18](navigation/US-NAV-18-not-found-route.md)           | Recover from an unmatched address                | Owner, Admin, Editor, Viewer; sign-in wall still applies to protected routes.                               | Current | New       |
| [US-NAV-19](navigation/US-NAV-19-connection-retry.md)          | Retry after a server connection failure          | Owner, Admin, Editor, Viewer                                                                                | Hidden  | New       |
| [US-NAV-20](navigation/US-NAV-20-account-load-recovery.md)     | Recover when the active company fails to load    | Owner, Admin, Editor, Viewer; Choose another is available only in demo mode.                                | Hidden  | New       |
| [US-NAV-21](navigation/US-NAV-21-browser-storage-recovery.md)  | Recover unreadable browser storage               | Anyone whose local browser data triggers the storage recovery screen; no company role applies.              | Hidden  | New       |
| [US-NAV-22](navigation/US-NAV-22-desktop-sidebar-toggle.md)    | Collapse or expand desktop navigation            | Owner, Admin, Editor, Viewer; also available in demo mode.                                                  | Current | New       |

## Privacy

| Story                                                                   | Action                                       | Access                                                                                                            | Status  | Catalogue |
| ----------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| [US-PRI-01](privacy/US-PRI-01-role-safe-private-name-display.md)        | Show private names according to role         | Owner sees real name and code name; Admin, Editor, Viewer receive only quoted code name; demo is owner-equivalent | Current | Existing  |
| [US-PRI-02](privacy/US-PRI-02-preserve-private-identities-on-writes.md) | Preserve protected names on non-Owner writes | Owner may manage privacy fields; Admin and Editor may make permitted ordinary edits; Viewer is read-only          | Current | Existing  |

## Projects

| Story                                                        | Action                                  | Access                                                                            | Status  | Catalogue |
| ------------------------------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------- | ------- | --------- |
| [US-PRJ-01](projects/US-PRJ-01-add-project.md)               | Add a project (must belong to a client) | Editor and above (Editor, Admin, Owner)                                           | Current | Existing  |
| [US-PRJ-02](projects/US-PRJ-02-edit-project.md)              | Edit a project                          | Editor and above (Editor, Admin, Owner)                                           | Current | Existing  |
| [US-PRJ-03](projects/US-PRJ-03-archive-project.md)           | Archive a project                       | Editor and above (Editor, Admin, Owner)                                           | Current | Existing  |
| [US-PRJ-04](projects/US-PRJ-04-manage-phases.md)             | Manage phases inside a project          | Editor and above (Editor, Admin, Owner)                                           | Hidden  | Existing  |
| [US-PRJ-05](projects/US-PRJ-05-private-project-code-name.md) | Mark a project private with a code name | Editor and above for ordinary fields; Owner only for privacy and code-name fields | Current | Existing  |
| [US-PRJ-06](projects/US-PRJ-06-restore-project.md)           | Restore an archived project             | Editor and above (Editor, Admin, Owner)                                           | Current | New       |

## Resources

| Story                                                     | Action                                        | Access                                                                           | Status  | Catalogue |
| --------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------- | ------- | --------- |
| [US-RES-01](resources/US-RES-01-add-person.md)            | Add a person resource                         | Editor and above (Editor, Admin, Owner)                                          | Current | Existing  |
| [US-RES-02](resources/US-RES-02-add-placeholder.md)       | Add a placeholder bound to a project          | Editor and above (Editor, Admin, Owner)                                          | Current | Existing  |
| [US-RES-03](resources/US-RES-03-edit-resource.md)         | Edit a resource's fields                      | Editor and above (Editor, Admin, Owner)                                          | Current | Existing  |
| [US-RES-04](resources/US-RES-04-archive-resource.md)      | Archive a resource                            | Editor and above (Editor, Admin, Owner)                                          | Current | Existing  |
| [US-RES-05](resources/US-RES-05-working-days.md)          | Set a resource's working days                 | Editor and above (Editor, Admin, Owner)                                          | Current | Existing  |
| [US-RES-06](resources/US-RES-06-working-hours.md)         | Use fixed resource working hours              | Editor and above (Editor, Admin, Owner)                                          | Current | Existing  |
| [US-RES-07](resources/US-RES-07-engagement.md)            | Studio or Supplementary engagement            | Editor and above (Editor, Admin, Owner)                                          | Current | Existing  |
| [US-RES-08](resources/US-RES-08-discipline-grouping.md)   | Group a resource under a discipline           | Editor and above (Editor, Admin, Owner)                                          | Current | Existing  |
| [US-RES-09](resources/US-RES-09-resource-colour.md)       | A resource's colour comes from its discipline | Viewer, Editor, Admin or Owner                                                   | Current | Existing  |
| [US-RES-10](resources/US-RES-10-resource-list-display.md) | The resource list display                     | Viewer, Editor, Admin or Owner; editing actions require Editor or higher         | Current | Existing  |
| [US-RES-11](resources/US-RES-11-availability-dates.md)    | Set a person's availability dates             | Editor and above (Editor, Admin, Owner)                                          | Current | Existing  |
| [US-RES-12](resources/US-RES-12-add-external-party.md)    | Add an external party                         | Editor and above (Editor, Admin, Owner)                                          | Current | New       |
| [US-RES-13](resources/US-RES-13-restore-resource.md)      | Restore an archived resource                  | Editor and above (Editor, Admin, Owner); only Owner/Admin see full inactive data | Current | New       |
| [US-RES-14](resources/US-RES-14-favourite-resource.md)    | Favourite a resource                          | Editor and above (Editor, Admin, Owner)                                          | Current | New       |
| [US-RES-15](resources/US-RES-15-edit-external-party.md)   | Edit an external party                        | Editor and above (Editor, Admin, Owner)                                          | Current | New       |
| [US-RES-16](resources/US-RES-16-anonymise-resource.md)    | Anonymise an archived resource                | Owner and Admin                                                                  | Current | New       |

## Scheduler

| Story                                                           | Action                                                             | Access                                                                   | Status  | Catalogue |
| --------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------- | --------- |
| [US-SCH-01](scheduler/US-SCH-01-grouped-capacity-cues.md)       | Resources grouped by discipline, with capacity cues                | Viewer, Editor, Admin or Owner; editing actions require Editor or higher | Current | Existing  |
| [US-SCH-02](scheduler/US-SCH-02-draw-allocation.md)             | Draw a new allocation across empty lane space                      | Editor, Admin or Owner                                                   | Current | Existing  |
| [US-SCH-03](scheduler/US-SCH-03-draw-time-off.md)               | Draw time off directly on a lane                                   | Editor, Admin or Owner                                                   | Current | Existing  |
| [US-SCH-04](scheduler/US-SCH-04-move-drag.md)                   | Move an allocation by dragging its body                            | Editor, Admin or Owner                                                   | Current | Existing  |
| [US-SCH-05](scheduler/US-SCH-05-resize.md)                      | Resize an allocation with its grip handles                         | Editor, Admin or Owner                                                   | Current | Existing  |
| [US-SCH-06](scheduler/US-SCH-06-reassign-drag.md)               | Reassign an allocation onto another resource                       | Editor, Admin or Owner                                                   | Current | Existing  |
| [US-SCH-07](scheduler/US-SCH-07-placeholder-reassign-reject.md) | Reassigning onto a mismatched placeholder is rejected              | Editor, Admin or Owner                                                   | Current | Existing  |
| [US-SCH-08](scheduler/US-SCH-08-lane-stacking.md)               | Overlapping allocations stack into separate lanes                  | Viewer, Editor, Admin or Owner; editing actions require Editor or higher | Current | Existing  |
| [US-SCH-09](scheduler/US-SCH-09-over-allocation.md)             | Over-allocated days are flagged with an over-marker                | Viewer, Editor, Admin or Owner; editing actions require Editor or higher | Current | Existing  |
| [US-SCH-10](scheduler/US-SCH-10-unavailable-days.md)            | Unavailable days are greyed (weekends, non-working days, time off) | Viewer, Editor, Admin or Owner; editing actions require Editor or higher | Current | Existing  |
| [US-SCH-11](scheduler/US-SCH-11-time-off-block.md)              | Time off renders as a labelled hatched block                       | Viewer, Editor, Admin or Owner; editing actions require Editor or higher | Current | Existing  |
| [US-SCH-12](scheduler/US-SCH-12-today-line.md)                  | A vertical line marks today                                        | Viewer, Editor, Admin or Owner; editing actions require Editor or higher | Current | Existing  |
| [US-SCH-13](scheduler/US-SCH-13-utilisation-flag.md)            | Per-resource near-term utilisation flag                            | Viewer, Editor, Admin or Owner; editing actions require Editor or higher | Current | Existing  |
| [US-SCH-14](scheduler/US-SCH-14-utilisation-summary.md)         | Overall and per-discipline utilisation summary                     | Viewer, Editor, Admin or Owner; editing actions require Editor or higher | Current | Existing  |
| [US-SCH-15](scheduler/US-SCH-15-bar-popover.md)                 | Allocation detail popover on hover/focus                           | Viewer, Editor, Admin or Owner; editing actions require Editor or higher | Current | Existing  |
| [US-SCH-16](scheduler/US-SCH-16-collapse-group.md)              | Collapse and expand a discipline group                             | Viewer, Editor, Admin or Owner; editing actions require Editor or higher | Current | Existing  |
| [US-SCH-17](scheduler/US-SCH-17-row-quick-create.md)            | Quick-create an allocation from a row's "+" button                 | Editor, Admin or Owner                                                   | Current | Existing  |
| [US-SCH-18](scheduler/US-SCH-18-quick-create-visible-window.md) | Quick-create defaults to the date you're looking at                | Editor, Admin or Owner                                                   | Current | Existing  |
| [US-SCH-19](scheduler/US-SCH-19-status-and-note-distinct.md)    | Allocation status and notes are visually distinct on the bar       | Viewer, Editor, Admin or Owner; editing actions require Editor or higher | Current | Existing  |
| [US-SCH-20](scheduler/US-SCH-20-person-schedule-drawer.md)      | Open a read-only person schedule                                   | Viewer, Editor, Admin or Owner                                           | Current | New       |

## Settings

| Story                                                       | Action                                   | Access                                                   | Status  | Catalogue |
| ----------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------- | ------- | --------- |
| [US-SET-01](settings/US-SET-01-calendar-settings.md)        | Company details                          | Owner, Admin, Editor, Viewer                             | Current | Existing  |
| [US-SET-02](settings/US-SET-02-bar-labels.md)               | Choose allocation bar labels             | Owner, Admin, Editor, Viewer                             | Current | Existing  |
| [US-SET-03](settings/US-SET-03-build-stamp.md)              | Read build details                       | Owner, Admin; anyone in demo mode                        | Current | Existing  |
| [US-SET-04](settings/US-SET-04-send-feedback.md)            | Open a feedback email                    | Owner, Admin; anyone in demo mode                        | Current | Existing  |
| [US-SET-05](settings/US-SET-05-minimise-weekends.md)        | Minimise weekend columns                 | Owner, Admin, Editor, Viewer                             | Current | Existing  |
| [US-SET-06](settings/US-SET-06-show-placeholders.md)        | Show placeholders                        | Editor and above; Viewers can read the setting.          | Current | Existing  |
| [US-SET-07](settings/US-SET-07-show-external.md)            | Show external resources                  | Editor and above; Viewers can read the setting.          | Current | Existing  |
| [US-SET-08](settings/US-SET-08-clear-local-storage.md)      | Keep device preferences separate         | Owner, Admin, Editor, Viewer                             | Current | Existing  |
| [US-SET-09](settings/US-SET-09-snap-to-week-start.md)       | Snap the schedule to week boundaries     | Owner, Admin, Editor, Viewer                             | Current | Existing  |
| [US-SET-10](settings/US-SET-10-member-management.md)        | Manage members and invitations           | Owner, Admin                                             | Current | Existing  |
| [US-SET-11](settings/US-SET-11-viewer-readonly.md)          | View role capabilities                   | Owner, Admin, Editor, Viewer                             | Current | Existing  |
| [US-SET-12](settings/US-SET-12-archived-deleted.md)         | Archive and anonymise records            | Owner, Admin, Editor                                     | Current | Existing  |
| [US-SET-13](settings/US-SET-13-password-reset-links.md)     | Recover a password                       | Any person with an account                               | Current | Existing  |
| [US-SET-14](settings/US-SET-14-internal-work-colours.md)    | Use neutral internal-work colours        | Owner, Admin, Editor, Viewer                             | Current | Existing  |
| [US-SET-15](settings/US-SET-15-global-working-days.md)      | Set company working days                 | Owner, Admin, Editor                                     | Current | Existing  |
| [US-SET-16](settings/US-SET-16-diagnostics.md)              | Copy diagnostics                         | Owner, Admin                                             | Current | Existing  |
| [US-SET-17](settings/US-SET-17-date-style.md)               | Choose the date format                   | Owner, Admin, Editor                                     | Current | Existing  |
| [US-SET-18](settings/US-SET-18-ownership-transfer.md)       | Transfer company ownership               | Owner                                                    | Current | Existing  |
| [US-SET-19](settings/US-SET-19-company-joining-policy.md)   | Approve company admission                | Owner, Admin; invited person                             | Current | Existing  |
| [US-SET-20](settings/US-SET-20-allocation-units.md)         | Choose scheduling units                  | Owner, Admin, Editor                                     | Current | New       |
| [US-SET-21](settings/US-SET-21-overview-access.md)          | Control Overview access                  | Owner, Admin can change; all roles see configured access | Current | New       |
| [US-SET-22](settings/US-SET-22-use-disciplines.md)          | Enable disciplines                       | Owner, Admin, Editor                                     | Current | New       |
| [US-SET-23](settings/US-SET-23-inline-activity-creation.md) | Create activities inline                 | Owner, Admin, Editor                                     | Current | New       |
| [US-SET-24](settings/US-SET-24-task-field.md)               | Show the Task field                      | Owner, Admin, Editor                                     | Current | New       |
| [US-SET-25](settings/US-SET-25-example-data.md)             | Add example data                         | Owner, Admin                                             | Current | New       |
| [US-SET-26](settings/US-SET-26-anonymise-all-people.md)     | Anonymise all people                     | Owner on the server; demo users for temporary demo data. | Current | New       |
| [US-SET-27](settings/US-SET-27-utilisation-visibility.md)   | Choose which utilisation figures to show | Viewer, Editor, Admin and Owner; this device only.       | Current | New       |

## Team

| Story                                              | Action                            | Access                                                          | Status  | Catalogue |
| -------------------------------------------------- | --------------------------------- | --------------------------------------------------------------- | ------- | --------- |
| [US-TEAM-01](team/US-TEAM-01-check-access.md)      | Check company access              | Owner, Admin, Editor, Viewer                                    | Current | New       |
| [US-TEAM-02](team/US-TEAM-02-invite-member.md)     | Invite a teammate                 | Owner, Admin                                                    | Current | New       |
| [US-TEAM-03](team/US-TEAM-03-manage-invitation.md) | Resend or revoke an invitation    | Owner, Admin                                                    | Current | New       |
| [US-TEAM-04](team/US-TEAM-04-accept-invitation.md) | Accept an emailed invitation      | Person with a valid invitation                                  | Current | New       |
| [US-TEAM-05](team/US-TEAM-05-request-admission.md) | Request and decide company access | Invited person; Owner or Admin decides requests                 | Current | New       |
| [US-TEAM-06](team/US-TEAM-06-change-membership.md) | Change a member's role or access  | Owner or Admin; own membership and the Owner are not manageable | Current | New       |
| [US-TEAM-07](team/US-TEAM-07-link-resource.md)     | Link a member to a Resource       | Owner, Admin                                                    | Current | New       |
| [US-TEAM-08](team/US-TEAM-08-view-as-member.md)    | View the company as a member      | Owner, Admin; another active member is the target               | Current | New       |
| [US-TEAM-11](team/US-TEAM-11-sign-in-tracking.md)  | Record member sign-ins            | Owner; the control is not currently rendered                    | Hidden  | New       |

## Time Off

| Story                                                     | Action                                                          | Access                         | Status  | Catalogue |
| --------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------ | ------- | --------- |
| [US-TOF-01](time-off/US-TOF-01-book-time-off.md)          | Book time off for a resource                                    | Editor, Admin or Owner         | Current | Existing  |
| [US-TOF-02](time-off/US-TOF-02-edit-time-off.md)          | Edit a time-off entry                                           | Editor, Admin or Owner         | Current | Existing  |
| [US-TOF-03](time-off/US-TOF-03-delete-time-off.md)        | Delete a time-off entry (confirmed)                             | Editor, Admin or Owner         | Current | Existing  |
| [US-TOF-04](time-off/US-TOF-04-type-label.md)             | Time-off list reads terse; the type label lives on the timeline | Viewer, Editor, Admin or Owner | Current | Existing  |
| [US-TOF-05](time-off/US-TOF-05-grouped-forward-view.md)   | Scan current and future time off by resource                    | Viewer, Editor, Admin or Owner | Current | Existing  |
| [US-TOF-06](time-off/US-TOF-06-company-wide-closure.md)   | Record a named company closure                                  | Editor, Admin or Owner         | Current | Existing  |
| [US-TOF-07](time-off/US-TOF-07-repeat-time-off.md)        | Create repeated personal time off                               | Editor, Admin or Owner         | Current | New       |
| [US-TOF-08](time-off/US-TOF-08-edit-company-closure.md)   | Edit a company closure                                          | Editor, Admin or Owner         | Current | New       |
| [US-TOF-09](time-off/US-TOF-09-delete-company-closure.md) | Delete a company closure                                        | Editor, Admin or Owner         | Current | New       |

## Toolbar

| Story                                                | Action                                                | Access                         | Status  | Catalogue |
| ---------------------------------------------------- | ----------------------------------------------------- | ------------------------------ | ------- | --------- |
| [US-TBR-01](toolbar/US-TBR-01-zoom.md)               | Zoom the timeline (1/2/4/6/8 weeks)                   | Viewer, Editor, Admin or Owner | Current | Existing  |
| [US-TBR-02](toolbar/US-TBR-02-pan.md)                | Pan a week back / forward                             | Viewer, Editor, Admin or Owner | Current | Existing  |
| [US-TBR-03](toolbar/US-TBR-03-today.md)              | Re-centre on Today                                    | Viewer, Editor, Admin or Owner | Current | Existing  |
| [US-TBR-04](toolbar/US-TBR-04-jump-to-date.md)       | Jump to a specific date (hidden from the toolbar)     | Viewer, Editor, Admin or Owner | Hidden  | Existing  |
| [US-TBR-05](toolbar/US-TBR-05-draw-mode.md)          | Switch Work / Time-off draw mode                      | Editor, Admin or Owner         | Current | Existing  |
| [US-TBR-06](toolbar/US-TBR-06-undo-redo-buttons.md)  | Undo / Redo toolbar buttons                           | Editor, Admin or Owner         | Current | Existing  |
| [US-TBR-07](toolbar/US-TBR-07-undo-redo-keyboard.md) | Undo / Redo with ⌘Z / ⌘⇧Z                             | Editor, Admin or Owner         | Current | Existing  |
| [US-TBR-08](toolbar/US-TBR-08-week-start-snap.md)    | Navigation re-anchors the left edge to the week start | Viewer, Editor, Admin or Owner | Current | Existing  |
