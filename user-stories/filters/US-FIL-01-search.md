# US-FIL-01 — Search resources by name or role

As a company member, I want to search resources by name or role so that I can find the people I want to review.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)

## Acceptance criteria

- **Search people…** filters resource rows by resource name or role.
- Clearing the query restores the matching rows.

## User flow

```mermaid
flowchart TD
  N1["Enter a name or role in Schedule search"]
  N2["matching resources remain"]
  B1["No matches ; then  see the empty state and clear filters"]
  B2["Clear the query ; then  matching rows return"]
  N1 --> N2
  N1 -.-> B1
  N1 -.-> B2
```

## Code flow

```mermaid
flowchart TD
  A["SchedulerToolbarFilters search input"] --> B["useToolbarSearch debounces committed query"]
  B --> C["schedulerSlice.setFilters updates local filter state"]
  C --> D["createAllocationFilters.resourceVisible matches name and role"]
  D --> E["SchedulerGrid renders filtered resources"]
  E --> F["No planning write or server mutation"]
```

**Code references:**

- [schedulerSlice.ts](../../apps/frontend/src/store/slices/schedulerSlice.ts)
- [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)
- [useToolbarSearch.ts](../../apps/frontend/src/components/scheduler/useToolbarSearch.ts)
- [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)
- [schedulerModelFilters.ts](../../apps/frontend/src/components/scheduler/schedulerModelFilters.ts)
- [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts)
- [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)
