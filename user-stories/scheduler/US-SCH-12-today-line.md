# US-SCH-12 — A vertical line marks today

As an Editor, I want today marked on the timeline so that I can orient myself within the visible date range.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner; editing actions require Editor or higher

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- When today, in the company time zone, falls within the loaded timeline range, a vertical line marks it on every resource row; when day columns are shown, the date header also highlights today. After navigating to a range that excludes today, neither appears.
- After midnight in the company time zone, the marker moves to the new date when the schedule next reads the company's data: within a minute while the tab is visible, or when the tab becomes visible again.

## User flow

```mermaid
flowchart TD
  A["Viewer opens Schedule"]
  B["Today is inside the loaded timeline range"]
  C["Today marker appears"]
  D["Today is outside the loaded timeline range"]
  E["No marker appears"]
  A --> B
  B --> C
  B --> D
  D --> E
```

## Code flow

```mermaid
flowchart TD
  A["useCompanyToday reads the company date sent with the planning read"] --> B["useSchedulerGridModel computes todayX from the loaded range geometry"]
  B --> C["SchedulerGridRows passes todayX to ResourceLane"]
  C --> D["ResourceLane renders today line only when todayX is in range"]
```

**Code references:** [useCompanyToday.ts](../../apps/frontend/src/hooks/useCompanyToday.ts), [useSchedulerGridModel.ts](../../apps/frontend/src/components/scheduler/useSchedulerGridModel.ts), [SchedulerGridRows.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRows.tsx), [ResourceLane.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.tsx)
