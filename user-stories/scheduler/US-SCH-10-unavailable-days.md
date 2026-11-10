# US-SCH-10 — Unavailable days are greyed (weekends, non-working days, time off)

As an Editor, I want non-working and time-off days distinguished so that I can plan around available days.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- Non-working days and time-off dates are visibly distinguished at fine zoom.

## User flow

```mermaid
flowchart TD
  A["Viewer selects a fine timeline scale"]
  B["Non-working and time-off days are visibly shaded"]
  C["Coarser scales omit the day shading"]
  A --> B
  B --> C
```

## Code flow

```mermaid
flowchart TD
  A["useSchedulerGridModel resolves day states and geometry"] --> B["buildSchedulerModel marks unavailable days"]
  B --> C["ResourceLane CalendarLayers checks perDayColumns"]
  C --> D["Unavailable day cells render the neutral tint"]
```

**Code references:** [useSchedulerGridModel.ts](../../apps/frontend/src/components/scheduler/useSchedulerGridModel.ts), [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts), [ResourceLane.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.tsx)
