# US-SCH-02 — Draw a new allocation across empty lane space

As an Editor, I want to draw a date range on an empty resource lane so that I can start an allocation with its resource and dates filled in.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- In Work mode, drawing across an empty resource lane opens a prefilled allocation form.
- The form uses that resource and the drawn date range.
