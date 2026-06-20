# Floaty — User stories

End-to-end user stories for **every** capability of Floaty, written as **runnable test
scripts for a human**. Each story is goal-first (what the user wants), then *why*, then
*how* (numbered, end-to-end steps from a defined starting state), then explicit, checkable
**acceptance criteria** (✅). Every story also names its automated coverage — the Playwright
**E2E test(s)** that exercise the same flow where one exists, or the **unit test / manual
check** otherwise — so the manual scripts and the suite stay in lock-step.

- **[REFERENCE.md](REFERENCE.md)** — the single source of truth: routes, control labels,
  `data-testid`s, the first-run seed data, and domain rules. Read this first.
- **[TEMPLATE.md](TEMPLATE.md)** — the story shape + a fully-worked exemplar.

**How to run a manual pass:** `npm run dev`, open <http://localhost:5173>, then work
through the areas below ticking each ✅. To reset to the seeded demo state, run
`localStorage.clear()` in the console and reload.

**How to run the automated coverage:** `npm run e2e` (Playwright drives the real app),
`npm test` (Vitest unit/component), and the axe a11y oracle in `e2e/a11y.spec.ts`.

88 stories across 13 areas. The **Automated coverage** column names the spec file(s) whose
tests assert the story's acceptance criteria; some intrinsically-visual or environment-only
stories (loading gate, storage-failure banner, toast auto-dismiss, error boundary, the today
line's position, the visible-window quick-create default, the drag-onto-placeholder rejection)
are covered by **unit tests and/or the manual script** instead, and are flagged as such. Two
stories whose UI is currently hidden (phase management — US-ACT-02, US-PRJ-04) are marked
**not runnable** until that UI returns.

---

## Navigation & shell — `navigation/`
| Story | Title | Automated coverage |
|---|---|---|
| [US-NAV-01](navigation/US-NAV-01-navigate-sections.md) | Navigate between all eight sections | `e2e/navigation.spec.ts` |
| [US-NAV-02](navigation/US-NAV-02-active-section-indicated.md) | Active section is indicated (`aria-current`) | `e2e/navigation.spec.ts` |
| [US-NAV-03](navigation/US-NAV-03-loading-gate.md) | Content gated on hydration ("Loading…") | manual (AppShell gates on `hydrated`) |
| [US-NAV-04](navigation/US-NAV-04-persist-error-banner.md) | Persistence-failure banner | manual + unit (`persist.test.ts` seed-fail) |
| [US-NAV-05](navigation/US-NAV-05-toast-autodismiss.md) | Transient toast (auto-dismiss) | `e2e/data.spec.ts` (toast appears); auto-dismiss manual |
| [US-NAV-06](navigation/US-NAV-06-dark-mode.md) | Light / dark theme preference | `e2e/navigation.spec.ts` + `e2e/a11y.spec.ts` (dark) |
| [US-NAV-07](navigation/US-NAV-07-error-boundary.md) | Recoverable error screen | unit (`ErrorBoundary.test.tsx`) + manual |
| [US-NAV-08](navigation/US-NAV-08-command-palette.md) | Command palette (⌘K / Ctrl+K) | `e2e/palette.spec.ts` |
| [US-NAV-09](navigation/US-NAV-09-mobile-affordances.md) | Mobile affordances (sidebar rail + rotate hint) | `e2e/mobile.spec.ts` |
| [US-NAV-10](navigation/US-NAV-10-login-screen.md) | Login screen (flag-gated; `FLOATY_AUTH` deploys only) | `e2e/login.auth.spec.ts` (auth-backed project) |

## Resources — `resources/`
| Story | Title | Automated coverage |
|---|---|---|
| [US-RES-01](resources/US-RES-01-add-person.md) | Add a person | `e2e/resources.spec.ts` |
| [US-RES-02](resources/US-RES-02-add-placeholder.md) | Add a placeholder bound to a project | `e2e/resources.spec.ts` |
| [US-RES-03](resources/US-RES-03-edit-resource.md) | Edit a resource | `e2e/resources.spec.ts` |
| [US-RES-04](resources/US-RES-04-delete-resource-cascade.md) | Delete a resource (cascade + undo) | `e2e/resources.spec.ts` |
| [US-RES-05](resources/US-RES-05-working-days.md) | Set working days | unit (`capacity.test.ts`) + manual |
| [US-RES-06](resources/US-RES-06-working-hours.md) | Set working hours (> 0) | `e2e/resources.spec.ts` |
| [US-RES-07](resources/US-RES-07-employment-temp-tag.md) | Employment type (Temp tag parked) | `e2e/resources.spec.ts` |
| [US-RES-08](resources/US-RES-08-discipline-grouping.md) | Group under a discipline | `e2e/resources.spec.ts` + `e2e/disciplines.spec.ts` |
| [US-RES-09](resources/US-RES-09-resource-colour.md) | Colour derives from discipline | `e2e/resources.spec.ts` |
| [US-RES-10](resources/US-RES-10-resource-list-display.md) | Resource list display | `e2e/resources.spec.ts` + unit (`ResourceList.test.tsx`) |

## Disciplines — `disciplines/`
| Story | Title | Automated coverage |
|---|---|---|
| [US-DIS-01](disciplines/US-DIS-01-add-discipline.md) | Add a discipline | `e2e/disciplines.spec.ts` |
| [US-DIS-02](disciplines/US-DIS-02-edit-discipline.md) | Edit a discipline | `e2e/disciplines.spec.ts` |
| [US-DIS-03](disciplines/US-DIS-03-delete-discipline-ungroups.md) | Delete (ungroups resources) | `e2e/disciplines.spec.ts` |
| [US-DIS-04](disciplines/US-DIS-04-sort-order.md) | Disciplines display in a stable order (ties broken by name) | `e2e/disciplines.spec.ts` + unit (`selectors.extra.test.ts`) |

## Clients — `clients/`
| Story | Title | Automated coverage |
|---|---|---|
| [US-CLI-01](clients/US-CLI-01-add-client.md) | Add a client | `e2e/clients.spec.ts` |
| [US-CLI-02](clients/US-CLI-02-edit-client.md) | Edit a client | `e2e/clients.spec.ts` |
| [US-CLI-03](clients/US-CLI-03-delete-client-cascade.md) | Delete a client (cascade) | `e2e/clients.spec.ts` + unit (`integrity.test.ts`) |

## Projects — `projects/`
| Story | Title | Automated coverage |
|---|---|---|
| [US-PRJ-01](projects/US-PRJ-01-add-project.md) | Add a project (needs a client) | `e2e/projects.spec.ts` + `e2e/crud.spec.ts` |
| [US-PRJ-02](projects/US-PRJ-02-edit-project.md) | Edit a project | `e2e/projects.spec.ts` |
| [US-PRJ-03](projects/US-PRJ-03-delete-project-cascade.md) | Delete a project (cascade) | `e2e/projects.spec.ts` + unit (`integrity.test.ts`) |
| [US-PRJ-04](projects/US-PRJ-04-manage-phases.md) | Manage phases in a project | manual — n/a (Phase UI hidden) |

## Activities — `activities/`
| Story | Title | Automated coverage |
|---|---|---|
| [US-ACT-01](activities/US-ACT-01-add-activity.md) | Add an activity (general or under a project) | `e2e/activities.spec.ts` |
| [US-ACT-02](activities/US-ACT-02-activity-phase.md) | Assign an activity to a phase | manual — n/a (Phase UI hidden) |
| [US-ACT-03](activities/US-ACT-03-edit-activity.md) | Edit an activity | `e2e/activities.spec.ts` |
| [US-ACT-04](activities/US-ACT-04-delete-activity-cascade.md) | Delete an activity (cascade) | `e2e/activities.spec.ts` |

## Time off — `time-off/`
| Story | Title | Automated coverage |
|---|---|---|
| [US-TOF-01](time-off/US-TOF-01-book-time-off.md) | Book time off | `e2e/timeoff.spec.ts` + `e2e/features.spec.ts` |
| [US-TOF-02](time-off/US-TOF-02-edit-time-off.md) | Edit a time-off entry | `e2e/timeoff.spec.ts` |
| [US-TOF-03](time-off/US-TOF-03-delete-time-off.md) | Delete a time-off entry (undo) | `e2e/timeoff.spec.ts` |
| [US-TOF-04](time-off/US-TOF-04-type-label.md) | Human type label | `e2e/timeoff.spec.ts` + unit (`TimeOffList.test.tsx`) |

## Scheduler timeline — `scheduler/`
| Story | Title | Automated coverage |
|---|---|---|
| [US-SCH-01](scheduler/US-SCH-01-grouped-capacity-cues.md) | Grouped rows + capacity cues | `e2e/scheduler.spec.ts` |
| [US-SCH-02](scheduler/US-SCH-02-draw-allocation.md) | Draw a new allocation | `e2e/scheduler.spec.ts` |
| [US-SCH-03](scheduler/US-SCH-03-draw-time-off.md) | Draw time off on a lane | `e2e/features.spec.ts` |
| [US-SCH-04](scheduler/US-SCH-04-move-drag.md) | Move an allocation by dragging | `e2e/scheduler.spec.ts` |
| [US-SCH-05](scheduler/US-SCH-05-resize.md) | Resize an allocation | `e2e/scheduler.spec.ts` |
| [US-SCH-06](scheduler/US-SCH-06-reassign-drag.md) | Reassign by dragging between rows | `e2e/features.spec.ts` |
| [US-SCH-07](scheduler/US-SCH-07-placeholder-reassign-reject.md) | Placeholder reassign rejected | unit (`AllocationBar.interaction.test.tsx`) + manual |
| [US-SCH-08](scheduler/US-SCH-08-lane-stacking.md) | Overlapping allocations stack | `e2e/scheduler.spec.ts` + unit (`lanePacking.test.ts`) |
| [US-SCH-09](scheduler/US-SCH-09-over-allocation.md) | Over-allocated days flagged | `e2e/scheduler.spec.ts` |
| [US-SCH-10](scheduler/US-SCH-10-unavailable-days.md) | Unavailable days greyed | `e2e/scheduler.spec.ts` |
| [US-SCH-11](scheduler/US-SCH-11-time-off-block.md) | Time off as a labelled block | `e2e/features.spec.ts` + `e2e/timeoff.spec.ts` |
| [US-SCH-12](scheduler/US-SCH-12-today-line.md) | Today line | `e2e/scheduler.spec.ts` |
| [US-SCH-13](scheduler/US-SCH-13-utilisation-flag.md) | Per-resource load %, red when over | `e2e/scheduler.spec.ts` + unit (`schedulerModel.test.ts`) |
| [US-SCH-14](scheduler/US-SCH-14-utilisation-summary.md) | Overall + per-discipline summary | `e2e/scheduler.spec.ts` |
| [US-SCH-15](scheduler/US-SCH-15-bar-popover.md) | Bar detail popover | `e2e/scheduler.spec.ts` + unit (`AllocationBar.interaction.test.tsx`) |
| [US-SCH-16](scheduler/US-SCH-16-collapse-group.md) | Collapse/expand a discipline group | `e2e/features.spec.ts` |
| [US-SCH-17](scheduler/US-SCH-17-row-quick-create.md) | Row "+" quick-create | `e2e/allocation.spec.ts` |
| [US-SCH-18](scheduler/US-SCH-18-quick-create-visible-window.md) | Quick-create defaults to visible window | manual |
| [US-SCH-19](scheduler/US-SCH-19-status-and-note-distinct.md) | Status & note visually distinct on the bar | `e2e/scheduler.spec.ts` |

## Allocation editor — `allocation/`
| Story | Title | Automated coverage |
|---|---|---|
| [US-ALL-01](allocation/US-ALL-01-create.md) | Create via the modal | `e2e/allocation.spec.ts` |
| [US-ALL-02](allocation/US-ALL-02-edit.md) | Edit an allocation | `e2e/allocation.spec.ts` |
| [US-ALL-03](allocation/US-ALL-03-duplicate.md) | Duplicate an allocation | `e2e/allocation.spec.ts` |
| [US-ALL-04](allocation/US-ALL-04-delete.md) | Delete an allocation | `e2e/allocation.spec.ts` |
| [US-ALL-05](allocation/US-ALL-05-add-activity-inline.md) | Add an activity inline | `e2e/allocation.spec.ts` |
| [US-ALL-06](allocation/US-ALL-06-change-assignee.md) | Change assignee | `e2e/allocation.spec.ts` |
| [US-ALL-07](allocation/US-ALL-07-placeholder-locks-project.md) | Placeholder locks the project | `e2e/allocation.spec.ts` + `e2e/features.spec.ts` |
| [US-ALL-08](allocation/US-ALL-08-validation.md) | Rejects bad input | `e2e/allocation.spec.ts` |

## Toolbar — `toolbar/`
| Story | Title | Automated coverage |
|---|---|---|
| [US-TBR-01](toolbar/US-TBR-01-zoom.md) | Zoom (1/2/4/6/8 weeks) | `e2e/toolbar.spec.ts` + `e2e/scheduler.spec.ts` |
| [US-TBR-02](toolbar/US-TBR-02-pan.md) | Pan a week | `e2e/toolbar.spec.ts` |
| [US-TBR-03](toolbar/US-TBR-03-today.md) | Re-centre on Today | `e2e/toolbar.spec.ts` + `e2e/scheduler.spec.ts` |
| [US-TBR-04](toolbar/US-TBR-04-jump-to-date.md) | Jump to a date | `e2e/toolbar.spec.ts` + `e2e/scheduler.spec.ts` |
| [US-TBR-05](toolbar/US-TBR-05-draw-mode.md) | Work / Time-off draw mode | `e2e/toolbar.spec.ts` + `e2e/features.spec.ts` |
| [US-TBR-06](toolbar/US-TBR-06-undo-redo-buttons.md) | No undo/redo toolbar buttons (keyboard-only) | `e2e/toolbar.spec.ts` |
| [US-TBR-07](toolbar/US-TBR-07-undo-redo-keyboard.md) | Undo/redo (⌘Z / ⌘⇧Z) | `e2e/toolbar.spec.ts` |

## Filters — `filters/`
| Story | Title | Automated coverage |
|---|---|---|
| [US-FIL-01](filters/US-FIL-01-search.md) | Search by name/role | `e2e/filters.spec.ts` |
| [US-FIL-02](filters/US-FIL-02-filter-discipline.md) | Filter by discipline | `e2e/filters.spec.ts` |
| [US-FIL-03](filters/US-FIL-03-filter-client.md) | Filter by client | `e2e/filters.spec.ts` |
| [US-FIL-04](filters/US-FIL-04-filter-project.md) | Filter by project | `e2e/filters.spec.ts` + `e2e/features.spec.ts` |
| [US-FIL-05](filters/US-FIL-05-hide-tentative.md) | Hide tentative | `e2e/filters.spec.ts` |
| [US-FIL-06](filters/US-FIL-06-clear-filters.md) | Clear all filters | `e2e/filters.spec.ts` |
| [US-FIL-07](filters/US-FIL-07-empty-state.md) | Filtered empty state | `e2e/filters.spec.ts` |

## Settings — `settings/`
| Story | Title | Automated coverage |
|---|---|---|
| [US-SET-01](settings/US-SET-01-calendar-settings.md) | Team calendar (week start + timezone) | `e2e/settings-calendar.spec.ts` |
| [US-SET-02](settings/US-SET-02-bar-labels.md) | Allocation-bar label toggles | `e2e/settings-bar-labels.spec.ts` |
| [US-SET-03](settings/US-SET-03-build-stamp.md) | Build stamp (flag-gated) | `e2e/settings-build-stamp.spec.ts` (absence by default) |
| [US-SET-04](settings/US-SET-04-send-feedback.md) | Send feedback mailto (flag-gated) | `e2e/settings-build-stamp.spec.ts` (absence by default) |

## Keyboard & accessibility — `accessibility/`
| Story | Title | Automated coverage |
|---|---|---|
| [US-KBD-01](accessibility/US-KBD-01-bar-keyboard.md) | Operate a bar by keyboard | `e2e/accessibility.spec.ts` |
| [US-KBD-02](accessibility/US-KBD-02-modal-keyboard.md) | Modal focus management | `e2e/accessibility.spec.ts` |
| [US-KBD-03](accessibility/US-KBD-03-grid-semantics.md) | Grid semantics + row summary | `e2e/accessibility.spec.ts` |
| [US-KBD-04](accessibility/US-KBD-04-axe-clean.md) | No serious/critical WCAG violations | `e2e/a11y.spec.ts` (light + dark + modal) |
| [US-KBD-05](accessibility/US-KBD-05-field-error-association.md) | Field-level error association | `e2e/accessibility.spec.ts` + unit (`ClientForm.test.tsx`) |

## Data management — `data/`
| Story | Title | Automated coverage |
|---|---|---|
| [US-DAT-01](data/US-DAT-01-export-json.md) | Export to JSON | `e2e/crud.spec.ts` |
| [US-DAT-02](data/US-DAT-02-import-json.md) | Import (with confirmation) | `e2e/data.spec.ts` |
| [US-DAT-03](data/US-DAT-03-undo-import.md) | Undo an import | `e2e/data.spec.ts` |
| [US-DAT-04](data/US-DAT-04-reject-non-floaty.md) | Reject a non-Floaty file | `e2e/data.spec.ts` |
| [US-DAT-05](data/US-DAT-05-persist-reload.md) | Persist across reload | `e2e/crud.spec.ts` |
| [US-DAT-06](data/US-DAT-06-seed-and-no-reseed.md) | Seed on first run, no re-seed after clear | `e2e/data.spec.ts` + `e2e/crud.spec.ts` |
