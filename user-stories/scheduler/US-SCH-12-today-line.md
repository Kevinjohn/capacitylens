# US-SCH-12 — A vertical line marks today

As an Editor, I want today marked on the timeline so that I can orient myself within the visible date range.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- A today marker appears when today is in view and disappears outside the visible range.

## User flow

```mermaid
flowchart TD
  A["Viewer opens Schedule"]
  B["Today is inside the visible range"]
  C["Today marker appears"]
  D["Today is outside the visible range"]
  E["No marker appears"]
  A --> B
  B --> C
  B --> D
  D --> E
```

## Code flow

```mermaid
flowchart TD
  A["useCalendarToday resolves today's company-local date"] --> B["useSchedulerGridModel computes todayX from visible geometry"]
  B --> C["SchedulerGridRows passes todayX to ResourceLane"]
  C --> D["ResourceLane renders today line only when todayX is in range"]
```

**Code references:** [useCalendarToday.ts](../../apps/frontend/src/components/scheduler/useCalendarToday.ts), [useSchedulerGridModel.ts](../../apps/frontend/src/components/scheduler/useSchedulerGridModel.ts), [SchedulerGridRows.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRows.tsx), [ResourceLane.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.tsx)
