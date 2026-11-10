# US-FIL-04 — Filter by project

As a company member, I want to filter allocations by project so that I can focus on work for that project.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)

## Acceptance criteria

- **Filter by project** limits visible allocations to the selected project.
- Project choices follow the selected client when a client filter is active; Clear Filters restores the full schedule.
