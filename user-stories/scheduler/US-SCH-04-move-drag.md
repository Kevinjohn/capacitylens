# US-SCH-04 — Move an allocation by dragging its body

As an Editor, I want to drag an allocation along its lane so that I can change its dates without changing its assignee.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- Dragging an allocation body moves it by whole days on the same resource. Unless Ignore working days is set, a moved start that falls on a non-working day moves on to the next working day in the drag direction, and the allocation keeps its working-day length.
- The resulting bar shows the updated dates.

## User flow

```mermaid
flowchart TD
  A["Editor drags an allocation body along its lane"]
  B["The bar previews its snapped date range"]
  C["Release saves the updated dates; rejection leaves the booking unchanged"]
  A --> B
  B --> C
```

## Code flow

```mermaid
flowchart TD
  A["AllocationBar calls useAllocationGesture"] --> B["useAllocationGestureController previews snapped movement"]
  B --> C["resolveGesture preserves the dates and load policy"]
  C --> D["savePointerCommit dispatches updateAllocation"]
  D --> E["planningTransport sends request to PlanningController"]
  E --> F["mutatePlanning commits writer transaction or returns refusal"]
  F --> G["planningCacheController reconciles success; refusal is surfaced"]
  G --> H["SchedulerGrid renders updated bar or keeps prior state"]
```

**Code references:** [AllocationBar.tsx](../../apps/frontend/src/components/scheduler/AllocationBar.tsx), [useAllocationGesture.ts](../../apps/frontend/src/components/scheduler/useAllocationGesture.ts), [useAllocationGestureController.ts](../../apps/frontend/src/components/scheduler/useAllocationGestureController.ts), [allocationDrag.ts](../../apps/frontend/src/components/scheduler/allocationDrag.ts), [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts), [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts), [storePlanningTransport.ts](../../apps/frontend/src/data/planning/storePlanningTransport.ts), [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts), [volatilePlanningTransport.ts](../../apps/frontend/src/data/planning/volatilePlanningTransport.ts), [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts), [planning.ts](../../apps/backend/app/services/planning.ts), [execute.ts](../../apps/backend/app/services/planning/execute.ts), [writer.ts](../../apps/backend/app/services/planning/writer.ts)
