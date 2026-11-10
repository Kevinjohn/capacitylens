# US-SCH-12 — A vertical line marks today

As an Editor, I want today marked on the timeline so that I can orient myself within the visible date range.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- A today marker appears when today is in view and disappears outside the visible range.
