# US-SCH-18 — Quick-create defaults to the date you're looking at

As an Editor, I want quick-create to use the date at the left edge of the visible Schedule so that the default matches the period I am viewing.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- The row **+** uses the visible timeline start date for the new allocation.
