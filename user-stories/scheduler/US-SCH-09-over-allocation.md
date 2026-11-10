# US-SCH-09 — Over-allocated days are flagged with an over-marker

As an Editor, I want over-capacity days marked on the Schedule so that I can see when allocated hours exceed availability.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- A day is marked over capacity only when allocated hours exceed available hours.

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
  A["useSchedulerGridModel builds fixed and visible windows"] --> B["buildSchedulerModel derives resource day capacity"]
  B --> C["buildDayCapacity compares load with availability"]
  C --> D["DayState marks over-capacity or time-off conflict"]
  D --> E["ResourceLane ScheduleSignals renders over-marker"]
```

**Code references:** [useSchedulerGridModel.ts](../../apps/frontend/src/components/scheduler/useSchedulerGridModel.ts), [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts), [ResourceLane.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.tsx)
