# US-FIL-03 — Filter by client

As a company member, I want to filter allocations by client while keeping capacity cues truthful so that I can review client work without hiding total workload.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)

## Acceptance criteria

- **Filter by client** lists Internal first, then clients by name. Choosing one limits visible allocations to that client and hides resources without matching work; capacity figures still include all work.
- **Show unallocated** reveals the hidden resources as dimmed rows.

## User flow

```mermaid
flowchart TD
  N1["Choose a client"]
  N2["matching allocation bars remain while total capacity stays visible"]
  B1["Show unallocated: unmatched resources appear dimmed"]
  N1 --> N2
  N1 -.-> B1
```

## Code flow

```mermaid
flowchart TD
  A["SchedulerToolbarSections client FilterSelect"] --> B["schedulerSlice.setFilters stores clientId"]
  B --> C["createAllocationFilters.allocVisible applies client lens"]
  C --> D["schedulerModel builds visible bars and full-work capacity"]
  D --> E["SchedulerGrid renders filtered work; unmatched rows follow showUnmatched"]
  E --> F["No planning write or server mutation"]
```

**Code references:**

- [schedulerSlice.ts](../../apps/frontend/src/store/slices/schedulerSlice.ts)
- [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx)
- [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)
- [schedulerModelFilters.ts](../../apps/frontend/src/components/scheduler/schedulerModelFilters.ts)
- [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts)
- [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)
