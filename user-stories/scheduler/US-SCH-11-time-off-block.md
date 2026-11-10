# US-SCH-11 — Time off renders as a labelled hatched block

As an Editor, I want time off shown as a labelled block so that absence is distinct from scheduled work.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- Time off appears as a distinct labelled block on the resource lane.

## User flow

```mermaid
flowchart TD
  A["Viewer opens a resource lane with time off"]
  B["A labelled hatched block appears on the covered dates"]
  C["Allocation bars remain a separate layer"]
  A --> B
  B --> C
```

## Code flow

```mermaid
flowchart TD
  A["useSchedulerGridModel reads scoped time off"] --> B["buildSchedulerModel creates TimeOffBlock layout"]
  B --> C["SchedulerGridRows passes blocks to ResourceLane"]
  C --> D["ScheduleSignals renders labelled hatched time-off blocks"]
```

**Code references:** [useSchedulerGridModel.ts](../../apps/frontend/src/components/scheduler/useSchedulerGridModel.ts), [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts), [SchedulerGridRows.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRows.tsx), [ResourceLane.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.tsx)
