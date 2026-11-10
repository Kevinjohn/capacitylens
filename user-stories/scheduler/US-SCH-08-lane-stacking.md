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
  A["useSchedulerGridModel supplies visible dates"] --> B["buildSchedulerModel creates resource bars"]
  B --> C["applyVisibleUtilization calls projectVisibleLanes"]
  C --> D["packLanes assigns lanes to overlapping bars"]
  D --> E["resolveRowHeightForLanes sizes the row"]
  E --> F["SchedulerGridRows renders bars in ResourceLane"]
```

**Code references:** [useSchedulerGridModel.ts](../../apps/frontend/src/components/scheduler/useSchedulerGridModel.ts), [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts), [SchedulerGridRows.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRows.tsx), [ResourceLane.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.tsx)
