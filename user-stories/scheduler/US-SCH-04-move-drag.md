# US-SCH-04 — Move an allocation by dragging its body

As an Editor, I want to drag an allocation along its lane so that I can change its dates without changing its assignee.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- Dragging an allocation body moves it by whole days on the same resource.
- The resulting bar shows the updated dates.
