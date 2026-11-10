# US-ALL-04 — Delete an allocation

As an Editor, I want to delete a cancelled allocation safely so that I can restore it if the deletion was a mistake.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx)

## Acceptance criteria

- **Delete** asks for confirmation; Cancel preserves the allocation.
- Confirming deletion removes the chosen allocation or permitted repeat tail; Undo restores it.

## User flow

```mermaid
flowchart TD
  N1["Open allocation"]
  N2["choose Delete"]
  N3["confirmation asks which occurrence scope when repeated"]
  B1["Cancel ; then  keep allocation"]
  B2["Confirm one / this and future ; then  delete selected scope ; then  Schedule updates; undo can restore"]
  N1 --> N2
  N2 --> N3
  N2 -.-> B1
  N2 -.-> B2
```

## Code flow

```mermaid
flowchart TD
  A["AllocationModal: Delete action"] --> B["RepeatedAllocationDeleteDialog when series has scope choice"]
  B -->|cancel| C["Keep allocation"]
  B -->|one| D["allocationSubmit.deleteSelectedAllocation: deleteAllocation"]
  B -->|this and future| E["deleteAllocationSeriesFrom"]
  D --> F["allocationSlice typed delete reconciles store; Schedule updates"]
  E --> F
```

**Code references:**

- [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx)
- [AllocationFooter.tsx](../../apps/frontend/src/components/scheduler/AllocationFooter.tsx)
- [RepeatedAllocationDeleteDialog.tsx](../../apps/frontend/src/components/scheduler/RepeatedAllocationDeleteDialog.tsx)
- [allocationSubmit.ts](../../apps/frontend/src/components/scheduler/allocationSubmit.ts)
- [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts)
- [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts)
