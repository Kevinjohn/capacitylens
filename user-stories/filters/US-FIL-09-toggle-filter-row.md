# US-FIL-09 — Show or hide the schedule filters

As a company member, I want to show or hide the filter row so that I can keep the Schedule compact when filters are not needed.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)

## Acceptance criteria

- **Show filters** opens the filter row and changes to **Hide filters**; hiding it removes those controls from view.
- The expanded row contains **Search people…**, the discipline, client, project and activity filters that apply, **Tentative**, the Work / Time off draw mode for Editors and above, **Show unallocated** while a client, project or activity filter is set, and **Clear Filters**.

## User flow

```mermaid
flowchart TD
  N1["Choose Show filters"]
  N2["filter row opens"]
  N3["choose Hide filters to close it; selections remain"]
  N1 --> N2
  N2 --> N3
```

## Code flow

```mermaid
flowchart TD
  A["SchedulerToolbarChrome filter toggle"] --> B["useToolbarSearch.setFiltersOpen changes local open state"]
  B --> C["SchedulerToolbarFilters renders conditionally"]
  C --> D["Filter values stay in schedulerSlice local state"]
  D --> E["No planning write or server mutation"]
```

**Code references:**

- [schedulerSlice.ts](../../apps/frontend/src/store/slices/schedulerSlice.ts)
- [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)
- [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)
- [schedulerModelFilters.ts](../../apps/frontend/src/components/scheduler/schedulerModelFilters.ts)
- [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts)
- [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)
