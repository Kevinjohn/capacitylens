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
  VIEW{"ViewFilters.hasLensFilter?"} -->|No| HIDDEN["Show unallocated omitted. Stored flag can survive lens changes"]
  VIEW -->|Yes| BOX["Checkbox reads showUnmatched, initially false"]
  BOX --> STORE["setToolbarFilters → setFilters updates showUnmatched"]
  STORE --> ELIGIBLE{"createAllocationFilters.resourceVisible?"}
  ELIGIBLE -->|No| OMIT["Exclude resource"]
  ELIGIBLE -->|Yes| MATCH{"createRowBuilder finds a renderable work match in the model timeline?"}
  MATCH -->|Yes| NORMAL["Keep normal row with matching bars"]
  MATCH -->|No| RETAIN{"buildSchedulerModel sees showUnmatched?"}
  RETAIN -->|No| OMIT
  RETAIN -->|Yes| DIM["SchedulerGridRow dims row with other in-timeline bars allowed by Tentative"]
  RESET["clearFilters → buildEmptyFilters resets flag"] --> VIEW
```

These controls use in-memory schedule filters for any role that can open Schedule, including Viewer and view-as-member. The resource predicate applies enabled kinds, search and any applicable discipline. Server capacity remains a separate row-builder input. Clearing the last lens hides the checkbox; a later lens can show it checked until Clear Filters resets it.

**Code references:** [SchedulerToolbarSections.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbarSections.tsx#L152) · [useToolbarSearch.ts](../../apps/frontend/src/components/scheduler/useToolbarSearch.ts#L47) · [schedulerSlice.ts](../../apps/frontend/src/store/slices/schedulerSlice.ts#L80) · [filters.ts](../../apps/frontend/src/store/filters.ts#L23) · [schedulerModelFilters.ts](../../apps/frontend/src/components/scheduler/schedulerModelFilters.ts#L11) · [schedulerRowModel.ts](../../apps/frontend/src/components/scheduler/schedulerRowModel.ts#L164) · [schedulerRowModel.ts](../../apps/frontend/src/components/scheduler/schedulerRowModel.ts#L66) · [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts#L208) · [SchedulerGridRow.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRow.tsx#L241) · [schedulerModel.filters.test.ts](../../apps/frontend/src/components/scheduler/schedulerModel.filters.test.ts#L186)
