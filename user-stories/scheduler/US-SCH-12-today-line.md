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
  Auth["AuthProvider rechecks visible session on focus, visibility or interval"] -->|signed in with active company| Read["refreshPlanning → readPlanning resolves company Today"]
  Auth -->|hidden, no company, or session check fails| NoRead["No refresh from this trigger"]
  Read --> Cache["Accept fresh Today in full or unchanged-revision reply"]
  Cache --> View["useSchedulerGridModel computes todayX for materialized range"]
  View -->|in range| Line["ResourceLaneLayers draws Today line"]
  View -->|out of range| None["No row line"]
  Cache --> Header["DateHeader highlights matching day where fine day tier renders"]
```

On failed refresh the client has no new authoritative date to apply. The visible-tab interval is 60 seconds.

**Code references:**

- [AuthProvider.tsx](../../apps/frontend/src/auth/AuthProvider.tsx#L98)
- [planning.ts](../../apps/backend/app/services/planning.ts#L96)
- [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L238)
- [useSchedulerGridModel.ts](../../apps/frontend/src/components/scheduler/useSchedulerGridModel.ts#L188)
- [DateHeader.tsx](../../apps/frontend/src/components/scheduler/DateHeader.tsx#L174)
- [ResourceLane.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.tsx#L167)
- [SchedulerGrid.test.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.test.tsx#L436)
