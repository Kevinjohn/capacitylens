# CapacityLens user stories

A catalogue of what people can do and why, with concise acceptance criteria for the fields
or controls they encounter. Historical stories stay discoverable when a feature is hidden or removed.

- [Coverage matrix](COVERAGE.md): actions, roles, availability and newly documented capabilities.
- [Decision gaps](GAPS.md): discrepancies and deliberately retained features.
- [Template](TEMPLATE.md): how to write and maintain a story.
- [Reference](REFERENCE.md): contexts, shared boundaries and source map.

179 stories across 19 areas. All 132 pre-existing story files and identifiers are retained.

Every story includes a plain-language user flowchart and a Mermaid diagram of the relevant code path,
with links to its implementation sources.

Status describes source-reviewed availability, not a browser test result. See the reference for
status definitions. Guide and implementation links live with each story; tests remain in the test suite.

## Accessibility

| Story                                                           | Action                                                 | Status  |
| --------------------------------------------------------------- | ------------------------------------------------------ | ------- |
| [US-KBD-01](accessibility/US-KBD-01-bar-keyboard.md)            | Operate schedule allocations by keyboard               | Current |
| [US-KBD-02](accessibility/US-KBD-02-modal-keyboard.md)          | Use dialogs with a keyboard                            | Current |
| [US-KBD-03](accessibility/US-KBD-03-grid-semantics.md)          | Understand the schedule grid with assistive technology | Current |
| [US-KBD-04](accessibility/US-KBD-04-axe-clean.md)               | Keep key screens accessible                            | Current |
| [US-KBD-05](accessibility/US-KBD-05-field-error-association.md) | Associate validation errors with fields                | Current |
| [US-KBD-06](accessibility/US-KBD-06-compact-input-modals.md)    | Scan management forms at different widths              | Current |

## Account

| Story                                                          | Action                               | Status  |
| -------------------------------------------------------------- | ------------------------------------ | ------- |
| [US-ACCOUNT-01](account/US-ACCOUNT-01-identity.md)             | Check my signed-in identity          | Current |
| [US-ACCOUNT-02](account/US-ACCOUNT-02-password-change.md)      | Change my password                   | Current |
| [US-ACCOUNT-03](account/US-ACCOUNT-03-password-reset.md)       | Recover a forgotten password         | Current |
| [US-ACCOUNT-04](account/US-ACCOUNT-04-sign-out.md)             | Sign out of this browser             | Current |
| [US-ACCOUNT-05](account/US-ACCOUNT-05-delete-account.md)       | Delete my account                    | Current |
| [US-ACCOUNT-06](account/US-ACCOUNT-06-register.md)             | Create my account from an invitation | Current |
| [US-ACCOUNT-07](account/US-ACCOUNT-07-confirm-email.md)        | Confirm my email address             | Current |
| [US-ACCOUNT-08](account/US-ACCOUNT-08-session-verification.md) | Retry session verification           | Current |
| [US-ACCOUNT-09](account/US-ACCOUNT-09-limited-access.md)       | Resolve my limited account access    | Current |

## Activities

| Story                                                        | Action                                                             | Status  |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | ------- |
| [US-ACT-01](activities/US-ACT-01-add-activity.md)            | Add an activity (internal, all-projects, or project-specific)      | Current |
| [US-ACT-02](activities/US-ACT-02-activity-phase.md)          | Assign an activity to a phase (optional; resets on project change) | Hidden  |
| [US-ACT-03](activities/US-ACT-03-edit-activity.md)           | Edit an activity                                                   | Current |
| [US-ACT-04](activities/US-ACT-04-delete-activity-cascade.md) | Archive an activity (allocations hidden)                           | Current |
| [US-ACT-05](activities/US-ACT-05-restore-activity.md)        | Restore an archived activity                                       | Current |

## Allocation

| Story                                                          | Action                                         | Status  |
| -------------------------------------------------------------- | ---------------------------------------------- | ------- |
| [US-ALL-01](allocation/US-ALL-01-create.md)                    | Create an allocation via the modal             | Current |
| [US-ALL-02](allocation/US-ALL-02-edit.md)                      | Edit an existing allocation                    | Current |
| [US-ALL-03](allocation/US-ALL-03-duplicate.md)                 | Duplicate an allocation                        | Current |
| [US-ALL-04](allocation/US-ALL-04-delete.md)                    | Delete an allocation                           | Current |
| [US-ALL-05](allocation/US-ALL-05-add-activity-inline.md)       | Add a new activity inline from the modal       | Current |
| [US-ALL-06](allocation/US-ALL-06-change-assignee.md)           | Change an allocation's assignee                | Current |
| [US-ALL-07](allocation/US-ALL-07-placeholder-locks-project.md) | Placeholder assignee locks the project         | Current |
| [US-ALL-08](allocation/US-ALL-08-validation.md)                | The modal rejects bad input                    | Current |
| [US-ALL-09](allocation/US-ALL-09-repeat-creation.md)           | Create repeating weekly or monthly allocations | Current |
| [US-ALL-10](allocation/US-ALL-10-task-field.md)                | Add an optional task to an allocation          | Current |
| [US-ALL-11](allocation/US-ALL-11-cancel-allocation-form.md)    | Cancel allocation create or edit               | Current |

## Capacity Overview

| Story                                                                 | Action                                       | Status  |
| --------------------------------------------------------------------- | -------------------------------------------- | ------- |
| [US-CAP-01](capacity-overview/US-CAP-01-review-four-week-capacity.md) | Review four-, eight- or twelve-week capacity | Current |

## Clients

| Story                                                      | Action                                 | Status  |
| ---------------------------------------------------------- | -------------------------------------- | ------- |
| [US-CLI-01](clients/US-CLI-01-add-client.md)               | Add a client                           | Current |
| [US-CLI-02](clients/US-CLI-02-edit-client.md)              | Edit a client                          | Current |
| [US-CLI-03](clients/US-CLI-03-archive-client.md)           | Archive a client                       | Current |
| [US-CLI-04](clients/US-CLI-04-internal-client.md)          | The built-in "Internal" client         | Current |
| [US-CLI-05](clients/US-CLI-05-private-client-code-name.md) | Mark a client private with a code name | Current |
| [US-CLI-06](clients/US-CLI-06-restore-client.md)           | Restore an archived client             | Current |

## Data

| Story                                                   | Action                                    | Status  |
| ------------------------------------------------------- | ----------------------------------------- | ------- |
| [US-DAT-01](data/US-DAT-01-export-json.md)              | Export company data                       | Current |
| [US-DAT-02](data/US-DAT-02-import-json.md)              | Preview and replace company data          | Current |
| [US-DAT-03](data/US-DAT-03-undo-import.md)              | Keep imported data outside undo history   | Current |
| [US-DAT-04](data/US-DAT-04-reject-non-capacitylens.md)  | Reject invalid import files               | Current |
| [US-DAT-05](data/US-DAT-05-persist-reload.md)           | Keep server changes after reload          | Current |
| [US-DAT-06](data/US-DAT-06-seed-and-no-reseed.md)       | Explore temporary demo data               | Demo    |
| [US-DAT-07](data/US-DAT-07-private-name-portability.md) | Preserve private names safely in transfer | Current |
| [US-DAT-08](data/US-DAT-08-preview-exact-import.md)     | Confirm the exact import operation        | Current |

## Disciplines

| Story                                                            | Action                                                 | Status  |
| ---------------------------------------------------------------- | ------------------------------------------------------ | ------- |
| [US-DIS-01](disciplines/US-DIS-01-add-discipline.md)             | Add a discipline                                       | Current |
| [US-DIS-02](disciplines/US-DIS-02-edit-discipline.md)            | Edit a discipline                                      | Current |
| [US-DIS-03](disciplines/US-DIS-03-delete-discipline-ungroups.md) | Delete a discipline (resources ungrouped, not deleted) | Current |
| [US-DIS-04](disciplines/US-DIS-04-sort-order.md)                 | Disciplines use a predictable order on each surface    | Current |

## Filters

| Story                                               | Action                                 | Status  |
| --------------------------------------------------- | -------------------------------------- | ------- |
| [US-FIL-01](filters/US-FIL-01-search.md)            | Search resources by name or role       | Current |
| [US-FIL-02](filters/US-FIL-02-filter-discipline.md) | Filter by discipline                   | Current |
| [US-FIL-03](filters/US-FIL-03-filter-client.md)     | Filter by client                       | Current |
| [US-FIL-04](filters/US-FIL-04-filter-project.md)    | Filter by project                      | Current |
| [US-FIL-05](filters/US-FIL-05-hide-tentative.md)    | Hide tentative allocations             | Current |
| [US-FIL-06](filters/US-FIL-06-clear-filters.md)     | Clear all filters at once              | Current |
| [US-FIL-07](filters/US-FIL-07-empty-state.md)       | Empty state when no resource matches   | Current |
| [US-FIL-08](filters/US-FIL-08-filter-activity.md)   | Filter by activity (the activity lens) | Current |
| [US-FIL-09](filters/US-FIL-09-toggle-filter-row.md) | Show or hide the schedule filters      | Current |
| [US-FIL-10](filters/US-FIL-10-show-unallocated.md)  | Show resources without matching work   | Current |

## Installation

| Story                                                     | Action                                  | Status   |
| --------------------------------------------------------- | --------------------------------------- | -------- |
| [US-INS-01](installation/US-INS-01-install-one-agency.md) | Install and operate one agency instance | Operator |

## Navigation

| Story                                                          | Action                                           | Status  |
| -------------------------------------------------------------- | ------------------------------------------------ | ------- |
| [US-NAV-01](navigation/US-NAV-01-navigate-sections.md)         | Navigate permitted sections                      | Current |
| [US-NAV-02](navigation/US-NAV-02-active-section-indicated.md)  | See the active section                           | Current |
| [US-NAV-03](navigation/US-NAV-03-loading-gate.md)              | Wait for company data                            | Current |
| [US-NAV-04](navigation/US-NAV-04-persist-error-banner.md)      | See planning read and save failures              | Current |
| [US-NAV-05](navigation/US-NAV-05-toast-autodismiss.md)         | Read and dismiss action notices                  | Current |
| [US-NAV-06](navigation/US-NAV-06-dark-mode.md)                 | Choose appearance                                | Current |
| [US-NAV-07](navigation/US-NAV-07-error-boundary.md)            | Recover from a rendering error                   | Current |
| [US-NAV-08](navigation/US-NAV-08-command-palette.md)           | Jump with the command palette                    | Current |
| [US-NAV-09](navigation/US-NAV-09-mobile-affordances.md)        | Use navigation on a narrow screen                | Current |
| [US-NAV-10](navigation/US-NAV-10-login-screen.md)              | Enter the persisted application                  | Current |
| [US-NAV-12](navigation/US-NAV-12-product-orientation.md)       | Understand the product at entry                  | Current |
| [US-NAV-13](navigation/US-NAV-13-getting-started.md)           | Track first schedule progress                    | Current |
| [US-NAV-14](navigation/US-NAV-14-company-picker-onboarding.md) | Set up and open the installation company         | Current |
| [US-NAV-15](navigation/US-NAV-15-semantic-colour-language.md)  | Recognize action meaning and product identity    | Current |
| [US-NAV-16](navigation/US-NAV-16-help-and-role-tour.md)        | Find help and a role-based tour                  | Current |
| [US-NAV-17](navigation/US-NAV-17-demo-mode.md)                 | Create, switch between, and reset demo companies | Demo    |
| [US-NAV-18](navigation/US-NAV-18-not-found-route.md)           | Recover from an unmatched address                | Current |
| [US-NAV-19](navigation/US-NAV-19-connection-retry.md)          | Retry after a server connection failure          | Hidden  |
| [US-NAV-20](navigation/US-NAV-20-account-load-recovery.md)     | Recover when the active company fails to load    | Hidden  |
| [US-NAV-21](navigation/US-NAV-21-browser-storage-recovery.md)  | Recover unreadable browser storage               | Hidden  |
| [US-NAV-22](navigation/US-NAV-22-desktop-sidebar-toggle.md)    | Collapse or expand desktop navigation            | Current |

## Privacy

| Story                                                                   | Action                                       | Status  |
| ----------------------------------------------------------------------- | -------------------------------------------- | ------- |
| [US-PRI-01](privacy/US-PRI-01-role-safe-private-name-display.md)        | Show private names according to role         | Current |
| [US-PRI-02](privacy/US-PRI-02-preserve-private-identities-on-writes.md) | Preserve protected names on non-Owner writes | Current |

## Projects

| Story                                                        | Action                                  | Status  |
| ------------------------------------------------------------ | --------------------------------------- | ------- |
| [US-PRJ-01](projects/US-PRJ-01-add-project.md)               | Add a project (must belong to a client) | Current |
| [US-PRJ-02](projects/US-PRJ-02-edit-project.md)              | Edit a project                          | Current |
| [US-PRJ-03](projects/US-PRJ-03-archive-project.md)           | Archive a project                       | Current |
| [US-PRJ-04](projects/US-PRJ-04-manage-phases.md)             | Manage phases inside a project          | Hidden  |
| [US-PRJ-05](projects/US-PRJ-05-private-project-code-name.md) | Mark a project private with a code name | Current |
| [US-PRJ-06](projects/US-PRJ-06-restore-project.md)           | Restore an archived project             | Current |

## Resources

| Story                                                     | Action                                        | Status  |
| --------------------------------------------------------- | --------------------------------------------- | ------- |
| [US-RES-01](resources/US-RES-01-add-person.md)            | Add a person resource                         | Current |
| [US-RES-02](resources/US-RES-02-add-placeholder.md)       | Add a placeholder bound to a project          | Current |
| [US-RES-03](resources/US-RES-03-edit-resource.md)         | Edit a resource's fields                      | Current |
| [US-RES-04](resources/US-RES-04-archive-resource.md)      | Archive a resource                            | Current |
| [US-RES-05](resources/US-RES-05-working-days.md)          | Set a resource's working days                 | Current |
| [US-RES-06](resources/US-RES-06-working-hours.md)         | Use fixed resource working hours              | Current |
| [US-RES-07](resources/US-RES-07-engagement.md)            | Studio or Supplementary engagement            | Current |
| [US-RES-08](resources/US-RES-08-discipline-grouping.md)   | Group a resource under a discipline           | Current |
| [US-RES-09](resources/US-RES-09-resource-colour.md)       | A resource's colour comes from its discipline | Current |
| [US-RES-10](resources/US-RES-10-resource-list-display.md) | The resource list display                     | Current |
| [US-RES-11](resources/US-RES-11-availability-dates.md)    | Set a person's availability dates             | Current |
| [US-RES-12](resources/US-RES-12-add-external-party.md)    | Add an external party                         | Current |
| [US-RES-13](resources/US-RES-13-restore-resource.md)      | Restore an archived resource                  | Current |
| [US-RES-14](resources/US-RES-14-favourite-resource.md)    | Favourite a resource                          | Current |
| [US-RES-15](resources/US-RES-15-edit-external-party.md)   | Edit an external party                        | Current |
| [US-RES-16](resources/US-RES-16-anonymise-resource.md)    | Anonymise an archived resource                | Current |

## Scheduler

| Story                                                           | Action                                                             | Status  |
| --------------------------------------------------------------- | ------------------------------------------------------------------ | ------- |
| [US-SCH-01](scheduler/US-SCH-01-grouped-capacity-cues.md)       | Resources grouped by discipline, with capacity cues                | Current |
| [US-SCH-02](scheduler/US-SCH-02-draw-allocation.md)             | Draw a new allocation across empty lane space                      | Current |
| [US-SCH-03](scheduler/US-SCH-03-draw-time-off.md)               | Draw time off directly on a lane                                   | Current |
| [US-SCH-04](scheduler/US-SCH-04-move-drag.md)                   | Move an allocation by dragging its body                            | Current |
| [US-SCH-05](scheduler/US-SCH-05-resize.md)                      | Resize an allocation with its grip handles                         | Current |
| [US-SCH-06](scheduler/US-SCH-06-reassign-drag.md)               | Reassign an allocation onto another resource                       | Current |
| [US-SCH-07](scheduler/US-SCH-07-placeholder-reassign-reject.md) | Reassigning onto a mismatched placeholder is rejected              | Current |
| [US-SCH-08](scheduler/US-SCH-08-lane-stacking.md)               | Overlapping allocations stack into separate lanes                  | Current |
| [US-SCH-09](scheduler/US-SCH-09-over-allocation.md)             | Over-allocated days are flagged with an over-marker                | Current |
| [US-SCH-10](scheduler/US-SCH-10-unavailable-days.md)            | Unavailable days are greyed (weekends, non-working days, time off) | Current |
| [US-SCH-11](scheduler/US-SCH-11-time-off-block.md)              | Time off renders as a labelled hatched block                       | Current |
| [US-SCH-12](scheduler/US-SCH-12-today-line.md)                  | A vertical line marks today                                        | Current |
| [US-SCH-13](scheduler/US-SCH-13-utilisation-flag.md)            | Per-resource near-term utilisation flag                            | Current |
| [US-SCH-14](scheduler/US-SCH-14-utilisation-summary.md)         | Overall and per-discipline utilisation summary                     | Current |
| [US-SCH-15](scheduler/US-SCH-15-bar-popover.md)                 | Allocation detail popover on hover/focus                           | Current |
| [US-SCH-16](scheduler/US-SCH-16-collapse-group.md)              | Collapse and expand a discipline group                             | Current |
| [US-SCH-17](scheduler/US-SCH-17-row-quick-create.md)            | Quick-create an allocation from a row's "+" button                 | Current |
| [US-SCH-18](scheduler/US-SCH-18-quick-create-visible-window.md) | Quick-create defaults to the date you're looking at                | Current |
| [US-SCH-19](scheduler/US-SCH-19-status-and-note-distinct.md)    | Allocation status and notes are visually distinct on the bar       | Current |
| [US-SCH-20](scheduler/US-SCH-20-person-schedule-drawer.md)      | Open a read-only person schedule                                   | Current |

## Settings

| Story                                                       | Action                                   | Status  |
| ----------------------------------------------------------- | ---------------------------------------- | ------- |
| [US-SET-01](settings/US-SET-01-calendar-settings.md)        | Company details                          | Current |
| [US-SET-02](settings/US-SET-02-bar-labels.md)               | Choose allocation bar labels             | Current |
| [US-SET-03](settings/US-SET-03-build-stamp.md)              | Read build details                       | Current |
| [US-SET-04](settings/US-SET-04-send-feedback.md)            | Open a feedback email                    | Current |
| [US-SET-05](settings/US-SET-05-minimise-weekends.md)        | Minimise weekend columns                 | Current |
| [US-SET-06](settings/US-SET-06-show-placeholders.md)        | Show placeholders                        | Current |
| [US-SET-07](settings/US-SET-07-show-external.md)            | Show external resources                  | Current |
| [US-SET-08](settings/US-SET-08-clear-local-storage.md)      | Keep device preferences separate         | Current |
| [US-SET-09](settings/US-SET-09-snap-to-week-start.md)       | Snap the schedule to week boundaries     | Current |
| [US-SET-10](settings/US-SET-10-member-management.md)        | Manage members and invitations           | Current |
| [US-SET-11](settings/US-SET-11-viewer-readonly.md)          | View role capabilities                   | Current |
| [US-SET-12](settings/US-SET-12-archived-deleted.md)         | Archive and anonymise records            | Current |
| [US-SET-13](settings/US-SET-13-password-reset-links.md)     | Recover a password                       | Current |
| [US-SET-14](settings/US-SET-14-internal-work-colours.md)    | Use neutral internal-work colours        | Current |
| [US-SET-15](settings/US-SET-15-global-working-days.md)      | Set company working days                 | Current |
| [US-SET-16](settings/US-SET-16-diagnostics.md)              | Copy diagnostics                         | Current |
| [US-SET-17](settings/US-SET-17-date-style.md)               | Choose the date format                   | Current |
| [US-SET-18](settings/US-SET-18-ownership-transfer.md)       | Transfer company ownership               | Current |
| [US-SET-19](settings/US-SET-19-company-joining-policy.md)   | Approve company admission                | Current |
| [US-SET-20](settings/US-SET-20-allocation-units.md)         | Choose scheduling units                  | Current |
| [US-SET-21](settings/US-SET-21-overview-access.md)          | Control Overview access                  | Current |
| [US-SET-22](settings/US-SET-22-use-disciplines.md)          | Enable disciplines                       | Current |
| [US-SET-23](settings/US-SET-23-inline-activity-creation.md) | Create activities inline                 | Current |
| [US-SET-24](settings/US-SET-24-task-field.md)               | Show the Task field                      | Current |
| [US-SET-25](settings/US-SET-25-example-data.md)             | Add example data                         | Current |
| [US-SET-26](settings/US-SET-26-anonymise-all-people.md)     | Anonymise all people                     | Current |
| [US-SET-27](settings/US-SET-27-utilisation-visibility.md)   | Choose which utilisation figures to show | Current |

## Team

| Story                                              | Action                            | Status  |
| -------------------------------------------------- | --------------------------------- | ------- |
| [US-TEAM-01](team/US-TEAM-01-check-access.md)      | Check company access              | Current |
| [US-TEAM-02](team/US-TEAM-02-invite-member.md)     | Invite a teammate                 | Current |
| [US-TEAM-03](team/US-TEAM-03-manage-invitation.md) | Resend or revoke an invitation    | Current |
| [US-TEAM-04](team/US-TEAM-04-accept-invitation.md) | Accept an emailed invitation      | Current |
| [US-TEAM-05](team/US-TEAM-05-request-admission.md) | Request and decide company access | Current |
| [US-TEAM-06](team/US-TEAM-06-change-membership.md) | Change a member's role or access  | Current |
| [US-TEAM-07](team/US-TEAM-07-link-resource.md)     | Link a member to a Resource       | Current |
| [US-TEAM-08](team/US-TEAM-08-view-as-member.md)    | View the company as a member      | Current |
| [US-TEAM-11](team/US-TEAM-11-sign-in-tracking.md)  | Record member sign-ins            | Hidden  |

## Time Off

| Story                                                     | Action                                                          | Status  |
| --------------------------------------------------------- | --------------------------------------------------------------- | ------- |
| [US-TOF-01](time-off/US-TOF-01-book-time-off.md)          | Book time off for a resource                                    | Current |
| [US-TOF-02](time-off/US-TOF-02-edit-time-off.md)          | Edit a time-off entry                                           | Current |
| [US-TOF-03](time-off/US-TOF-03-delete-time-off.md)        | Delete a time-off entry (confirmed)                             | Current |
| [US-TOF-04](time-off/US-TOF-04-type-label.md)             | Time-off list reads terse; the type label lives on the timeline | Current |
| [US-TOF-05](time-off/US-TOF-05-grouped-forward-view.md)   | Scan current and future time off by resource                    | Current |
| [US-TOF-06](time-off/US-TOF-06-company-wide-closure.md)   | Record a named company closure                                  | Current |
| [US-TOF-07](time-off/US-TOF-07-repeat-time-off.md)        | Create repeated personal time off                               | Current |
| [US-TOF-08](time-off/US-TOF-08-edit-company-closure.md)   | Edit a company closure                                          | Current |
| [US-TOF-09](time-off/US-TOF-09-delete-company-closure.md) | Delete a company closure                                        | Current |

## Toolbar

| Story                                                | Action                                                | Status  |
| ---------------------------------------------------- | ----------------------------------------------------- | ------- |
| [US-TBR-01](toolbar/US-TBR-01-zoom.md)               | Zoom the timeline (1/2/4/6/8 weeks)                   | Current |
| [US-TBR-02](toolbar/US-TBR-02-pan.md)                | Pan a week back / forward                             | Current |
| [US-TBR-03](toolbar/US-TBR-03-today.md)              | Re-centre on Today                                    | Current |
| [US-TBR-04](toolbar/US-TBR-04-jump-to-date.md)       | Jump to a specific date (hidden from the toolbar)     | Hidden  |
| [US-TBR-05](toolbar/US-TBR-05-draw-mode.md)          | Switch Work / Time-off draw mode                      | Current |
| [US-TBR-06](toolbar/US-TBR-06-undo-redo-buttons.md)  | Undo / Redo toolbar buttons                           | Current |
| [US-TBR-07](toolbar/US-TBR-07-undo-redo-keyboard.md) | Undo / Redo with ⌘Z / ⌘⇧Z                             | Current |
| [US-TBR-08](toolbar/US-TBR-08-week-start-snap.md)    | Navigation re-anchors the left edge to the week start | Current |
