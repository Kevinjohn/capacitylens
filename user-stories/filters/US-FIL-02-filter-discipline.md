# US-FIL-02 — Filter by discipline

As a company member, I want to filter resources by discipline so that I can focus on one team.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)

## Acceptance criteria

- **Filter by discipline** lists the company disciplines.
- Selecting a discipline shows only its resource group; All disciplines restores the groups.

## User flow

```mermaid
flowchart TD
  N1["Open filters"]
  N2["choose a discipline"]
  N3["only that resource group remains"]
  N4["choose All disciplines to restore all groups"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
```

## Code flow

```mermaid
flowchart TD
  A["SchedulerToolbarSections discipline FilterSelect"] --> B["SchedulerToolbar.setFilters callback"]
  B --> C["schedulerSlice.setFilters stores disciplineId"]
  C --> D["createAllocationFilters.resourceVisible checks disciplineId"]
  D --> E["SchedulerGrid renders matching resource groups"]
  E --> F["No planning write or server mutation"]
```

**Code references:**

- [schedulerSlice.ts](../../apps/frontend/src/store/slices/schedulerSlice.ts)
- [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)
- [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)
- [schedulerModelFilters.ts](../../apps/frontend/src/components/scheduler/schedulerModelFilters.ts)
- [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts)
- [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)
