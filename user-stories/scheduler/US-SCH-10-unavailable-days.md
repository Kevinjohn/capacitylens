# US-SCH-10 — Unavailable days are greyed (weekends, non-working days, time off)

As an Editor, I want non-working and time-off days distinguished so that I can plan around available days.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- When the zoom is fine enough to draw day columns (at least 18 px per day), each day a resource cannot take new work — a non-working day, a closure or a time-off day — is shaded grey on its row. A personal half day is shaded on the lower half of the row.
- At coarser zoom the day shading is omitted; time off still shows as its own block (see [US-SCH-11](US-SCH-11-time-off-block.md)).

## User flow

```mermaid
flowchart TD
  A["Viewer zooms in until day columns are at least 18 px wide"]
  B["Non-working, closure and time-off days are shaded grey"]
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
