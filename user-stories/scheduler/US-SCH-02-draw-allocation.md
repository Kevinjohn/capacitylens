# US-SCH-02 — Draw a new allocation across empty lane space

As an Editor, I want to draw a date range on an empty resource lane so that I can start an allocation with its resource and dates filled in.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- In Work mode, drawing across an empty resource lane opens a prefilled allocation form.
- The form uses that resource and the drawn date range.

## User flow

```mermaid
flowchart TD
  A["Editor draws across an empty resource lane in Work mode"]
  B["A new allocation form opens with that resource and date span"]
  C["Editor chooses Save"]
  D["Booking is created"]
  E["Editor chooses Cancel"]
  F["Form closes without saving"]
  A --> B
  B --> C
  C --> D
  B --> E
  E --> F
```

## Code flow

```mermaid
flowchart TD
  A["ResourceLane calls useResourceLaneInteraction.finishGesture"] --> B["SchedulerGrid.openDrawModal checks placement and sets create modal"]
  B --> C["AllocationModal submits through useStore.addAllocation"]
  C --> D["allocationSlice creates typed planning intent"]
  D --> E["createStorePlanningTransport selects server or demo transport"]
  E -->|server| F["planningTransport sends allocation.create API operation"]
  F --> G["PlanningController.allocationCreate calls mutatePlanning"]
  G --> H["executePlanningIntent and writer persist inside transaction"]
  E -->|demo| I["volatilePlanningTransport updates in-memory data"]
  H --> J["planningCacheController reconciles receipt and publishes grid"]
  I --> J
```

**Code references:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx), [useResourceLaneInteraction.ts](../../apps/frontend/src/components/scheduler/useResourceLaneInteraction.ts), [SchedulerGridRow.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRow.tsx), [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx), [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts), [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts), [storePlanningTransport.ts](../../apps/frontend/src/data/planning/storePlanningTransport.ts), [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts), [volatilePlanningTransport.ts](../../apps/frontend/src/data/planning/volatilePlanningTransport.ts), [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts), [planning.ts](../../apps/backend/app/services/planning.ts), [execute.ts](../../apps/backend/app/services/planning/execute.ts), [writer.ts](../../apps/backend/app/services/planning/writer.ts)
