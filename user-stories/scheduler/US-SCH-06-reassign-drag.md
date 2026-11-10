# US-SCH-06 — Reassign an allocation onto another resource

As an Editor, I want to drag an allocation onto another resource so that I can reassign work on the Schedule.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- Dragging an allocation to another resource reassigns it when valid.
- The bar appears on the destination resource row.
