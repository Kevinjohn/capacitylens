# US-FIL-07 — Empty state when no resource matches

As a company member, I want a clear empty state when filters match no resources so that I know the schedule is filtered rather than missing data.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)

## Acceptance criteria

- When filters leave no resource rows, the Schedule shows **No resources match the current filters.** with a **Clear filters** action.
- Clearing the filters restores the schedule rows.

## User flow

```mermaid
flowchart TD
  N1["Apply filters with no matching resources"]
  N2["empty state explains the view"]
  B1["Clear filters: schedule rows return"]
  N1 --> N2
  N1 -.-> B1
```

## Code flow

```mermaid
flowchart TD
  A["buildSchedulerModel applies active filters"] --> B["SchedulerGrid detects no visible resources"]
  B --> C["Empty state offers Clear filters action"]
  C --> D["schedulerSlice.clearFilters resets local filters"]
  D --> E["SchedulerGrid renders matching rows"]
  E --> F["No planning write or server mutation"]
```

**Code references:**

- [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)
- [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)
- [schedulerModelFilters.ts](../../apps/frontend/src/components/scheduler/schedulerModelFilters.ts)
- [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts)
- [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)
- [schedulerSlice.ts](../../apps/frontend/src/store/slices/schedulerSlice.ts)
