# US-SCH-07 — Reassigning onto a mismatched placeholder is rejected

As an Editor, I want a mismatched placeholder reassignment to be rejected so that work cannot drift from the placeholder’s bound project.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- A drop onto a placeholder bound to another project is rejected.
- The allocation stays unchanged and the user sees a reason.

## User flow

```mermaid
flowchart TD
  A["Editor drops a booking onto a placeholder bound to another project"]
  B["The move is refused with an explanation"]
  C["The booking remains on its original resource and dates"]
  A --> B
  B --> C
```

## Code flow

```mermaid
flowchart TD
  A["AllocationBar begins pointer gesture"] --> B["useAllocationGestureController previews target lane"]
  B --> C["isPreviewDropBlocked checks placeholder and working-day compatibility"]
  C -->|blocked| D["Preview stays on source lane; commit is refused"]
  C -->|allowed| E["Release may call updateAllocation"]
  E --> F["PlanningController and planning writer handle accepted update"]
```

**Code references:** [AllocationBar.tsx](../../apps/frontend/src/components/scheduler/AllocationBar.tsx), [useAllocationGesture.ts](../../apps/frontend/src/components/scheduler/useAllocationGesture.ts), [useAllocationGestureController.ts](../../apps/frontend/src/components/scheduler/useAllocationGestureController.ts), [gestureWorkingWeeks.ts](../../apps/frontend/src/components/scheduler/gestureWorkingWeeks.ts), [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts), [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts), [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts), [planning.ts](../../apps/backend/app/services/planning.ts), [execute.ts](../../apps/backend/app/services/planning/execute.ts)
