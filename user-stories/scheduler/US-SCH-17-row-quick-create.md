# US-SCH-17 — Quick-create an allocation from a row's "+" button

As an Editor, I want to start an allocation from a resource row so that the correct resource is already selected.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- The row **+** opens a new allocation form with that resource selected.
- The form title identifies the resource.
