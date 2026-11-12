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

## User flow

```mermaid
flowchart TD
  A["Editor drags an allocation edge"]
  B["The bar previews its snapped date range"]
  C["Release saves the updated dates; rejection leaves the booking unchanged"]
  A --> B
  B --> C
```

## Code flow

```mermaid
flowchart TD
  A["AllocationBar calls useAllocationGesture"] --> B["useAllocationGestureController resolves gesture and preview"]
  B --> C["resolveGesture applies snapped dates and mode-specific load rules"]
  C --> D["Commit gate checks destination and start date"]
  D --> E["savePointerCommit calls updateAllocation once"]
  E --> F["allocationSlice creates allocation.update intent"]
  F --> G["PlanningTransport sends the typed server request"]
  G --> H["Server: PlanningController.mutatePlanning executes writer transaction"]
  G --> I["Server receipt reconciles into SchedulerGrid"]
```

**Code references:** [AllocationBar.tsx](../../apps/frontend/src/components/scheduler/AllocationBar.tsx), [useAllocationGesture.ts](../../apps/frontend/src/components/scheduler/useAllocationGesture.ts), [useAllocationGestureController.ts](../../apps/frontend/src/components/scheduler/useAllocationGestureController.ts), [allocationDrag.ts](../../apps/frontend/src/components/scheduler/allocationDrag.ts), [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts), [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts), [storePlanningTransport.ts](../../apps/frontend/src/data/planning/storePlanningTransport.ts), [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts), [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts), [planning.ts](../../apps/backend/app/services/planning.ts), [execute.ts](../../apps/backend/app/services/planning/execute.ts), [writer.ts](../../apps/backend/app/services/planning/writer.ts)
