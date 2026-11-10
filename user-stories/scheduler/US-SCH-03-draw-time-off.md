# US-SCH-03 — Draw time off directly on a lane

As an Editor, I want to draw a date range in Time off mode so that I can start a time-off entry for the resource on that lane.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- In Time off mode, drawing on a resource lane opens a prefilled time-off form.
- The lane’s work bars do not intercept the time-off draw.
