# US-FIL-08 — Filter by activity (the activity lens)

As a company member, I want an activity lens across projects so that I can review internal or All projects work by activity.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)

## Acceptance criteria

- **Filter by project** limits visible allocations to the selected project.
- Project choices follow the selected client when a client filter is active; Clear Filters restores the full schedule.
