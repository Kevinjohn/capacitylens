# US-FIL-09 — Show or hide the schedule filters

As a company member, I want to show or hide the filter row so that I can keep the Schedule compact when filters are not needed.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)

## Acceptance criteria

- **Show filters** opens the filter row and changes to **Hide filters**; hiding it removes those controls from view.
- The expanded row contains search, filter controls, draw mode and Clear Filters.
