# US-SCH-05 — Resize an allocation with its grip handles

As an Editor, I want to resize an allocation by its edge so that I can change its date range directly on the Schedule.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- Dragging either edge changes the allocation date range by whole days. Unless Ignore working days is set, an edge dropped on a non-working day moves on to the next working day in the drag direction.
- The allocation remains at least one day long.
