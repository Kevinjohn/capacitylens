# US-SCH-08 — Overlapping allocations stack into separate lanes

As an Editor, I want overlapping allocations to appear in separate lanes so that each booking remains visible.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- Overlapping allocations on one resource occupy separate lanes.
- Non-overlapping allocations can share a lane.

## User flow

```mermaid
flowchart TD
  A["Viewer opens a date range with overlapping bookings"]
  B["Overlapping bars occupy separate lanes"]
  C["Non-overlapping bars share a lane"]
  A --> B
  B --> C
```

## Code flow

```mermaid
flowchart TD
  View["useSchedulerGridModel derives visible dates from zoom and scroll"] --> Range["projectVisibleLanes filters materialized bars to visible inclusive window"]
  Range -->|partial next column| Extend["Include that day in packing range"]
  Range -->|aligned| Pack["packLanes sorts and packs"]
  Extend --> Pack
  Pack -->|overlap, including equal endpoint| Stack["Assign another lane"]
  Pack -->|no overlap| Reuse["Reuse lane"]
  Stack --> Height["resolveRowHeightForLanes and resolveLaneTop set layout"]
  Reuse --> Height
  Height --> Render["SchedulerGridRow renders resulting height and bars"]
```

**Code references:**

- [useSchedulerGridModel.ts](../../apps/frontend/src/components/scheduler/useSchedulerGridModel.ts#L188)
- [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts#L62)
- [lanePacking.ts](../../apps/frontend/src/lib/lanePacking.ts#L41)
- [SchedulerGridRow.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRow.tsx#L245)
- [schedulerModel.visibleLanes.test.ts](../../apps/frontend/src/components/scheduler/schedulerModel.visibleLanes.test.ts#L1)
