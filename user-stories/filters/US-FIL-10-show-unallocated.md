# US-FIL-10 — Show resources without matching work

As a company member, I want to show unallocated resources while a client, project or activity lens is active so that I can see who has capacity outside the filtered work.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`), expanded filter row, after selecting a client, project or activity lens

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)

## Acceptance criteria

- **Show unallocated** is an unchecked checkbox shown only when a client, project or activity lens is active.
- Checking it restores resources without matching work as visible, dimmed rows; their capacity figures remain based on all work.

## User flow

```mermaid
flowchart TD
  N1["Choose a client, project or activity lens"]
  N2["Show unallocated appears"]
  N3["check it to show unmatched dimmed resources"]
  N4["uncheck it to hide them"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
```

## Code flow

```mermaid
flowchart TD
  A["SchedulerToolbarSections Show unallocated checkbox"] --> B["schedulerSlice.setFilters stores showUnmatched"]
  B --> C["schedulerModel includes unmatched resources as dimmed rows"]
  C --> D["Capacity calculation continues to use all work"]
  D --> E["No planning write or server mutation"]
```

**Code references:**

- [schedulerSlice.ts](../../apps/frontend/src/store/slices/schedulerSlice.ts)
- [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)
- [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)
- [schedulerModelFilters.ts](../../apps/frontend/src/components/scheduler/schedulerModelFilters.ts)
- [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts)
- [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)
