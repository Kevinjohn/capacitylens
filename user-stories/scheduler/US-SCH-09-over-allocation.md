# US-SCH-09 — Over-allocated days are flagged with an over-marker

As an Editor, I want over-capacity days marked on the Schedule so that I can see when allocated hours exceed availability.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- With Hours or Days scheduling input, a resource day gets the over-capacity marker (red top border and red fill) only when its allocated hours exceed its available hours; at or below availability, no marker appears.
- With Blocks, allocations carry no hours, so a day is marked only when an allocation falls on a time-off day.
- On a day with time off, the marker uses a stronger red fill. External resources are not capacity-tracked and show no marker.

## User flow

```mermaid
flowchart TD
  A["Viewer sees a resource day"]
  B["Allocated hours exceed availability"]
  C["Over-capacity marker appears"]
  D["Load is at or below availability"]
  E["No marker appears"]
  A --> B
  B --> C
  A --> D
  D --> E
```

## Code flow

```mermaid
flowchart TD
  A["The server's planning read computes each resource day's over flag for the grid's window"] --> B["buildSchedulerModel reads the flag for each timeline date"]
  B --> D["DayState marks over-capacity or time-off conflict"]
  D --> E["ResourceLane ScheduleSignals renders over-marker"]
```

**Code references:** [capacity_section.ts](../../apps/backend/app/services/planning/capacity_section.ts), [schedulerRowCapacity.ts](../../apps/frontend/src/components/scheduler/schedulerRowCapacity.ts), [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts), [ResourceLane.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.tsx)
