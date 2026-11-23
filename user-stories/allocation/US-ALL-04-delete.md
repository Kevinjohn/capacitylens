# US-ALL-04 — Delete an allocation

As an Editor, I want to delete an allocation that is no longer needed so that the Schedule stays current, with undo if I delete it by mistake.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [AllocationDialog.tsx](../../apps/frontend/src/components/scheduler/AllocationDialog.tsx)

## Acceptance criteria

- In the Edit allocation dialog, **Delete** opens **Delete allocation?** with **Delete** and **Cancel**.
- For an allocation in a repeating series it opens **Delete repeated allocation?** with **Delete this occurrence**, **Delete this and future occurrences** and **Cancel**.
- **Cancel** keeps the allocation. A confirmed deletion removes the chosen allocation, or it and the later occurrences in its series; ⌘Z / Ctrl+Z (or **Undo**) restores it.

## User flow

```mermaid
flowchart TD
  N1["Open an allocation"]
  N2["choose Delete"]
  N3["confirm; a repeated allocation offers this occurrence or this and future occurrences"]
  N4["the chosen allocations leave the Schedule; Undo can restore them"]
  B1["Cancel: keep the allocation"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
  N3 -.-> B1
```

## Code flow

```mermaid
flowchart TD
  Edit["AllocationFooter renders Delete for a writable allocation"] -->|ordinary| One["ConfirmDialog"]
  Edit -->|series| Series["RepeatedAllocationDeleteDialog"]
  One -->|Cancel| Edit
  Series -->|Cancel| Edit
  One -->|Delete| Close["deleteSelectedAllocation closes confirmation"]
  Series -->|This occurrence or future| Close
  Close --> Check["deleteAllocation or deleteAllocationSeriesFrom resolves current row"]
  Check -->|missing or viewer| Noop["No request"]
  Check --> Send["allocation.delete, with scope future for the series tail"]
  Send --> Commit["commit authorizes and checks revision; executePlanningIntent soft-deletes a restoration group"]
  Commit -->|committed receipt| Gone["Reconcile removals; useAllocationDialogInputs closes when row disappears"]
  Commit -->|refused| Err["Underlying edit dialog reports failure; stale revision refreshes"]
  Commit -->|lost or invalid reply| Unknown["Canonical refetch can already omit the row; no replay"]
```

For future scope, `resolveSeriesFrom` selects rows in the same series beginning at or after the selected start. The transaction records a single recoverable deletion group for eligible Undo.

**Code references:**

- [AllocationFooter.tsx](../../apps/frontend/src/components/scheduler/AllocationFooter.tsx#L19)
- [allocationSubmit.ts](../../apps/frontend/src/components/scheduler/allocationSubmit.ts#L271)
- [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts#L164)
- [execute.ts](../../apps/backend/app/services/planning/execute.ts#L50)
- [execute.ts](../../apps/backend/app/services/planning/execute.ts#L426)
- [useAllocationDialogState.ts](../../apps/frontend/src/components/scheduler/useAllocationDialogState.ts#L125)
- [planning_mutations_controller.ts](../../apps/backend/app/controllers/planning_mutations_controller.ts#L7)
- [planning.ts](../../apps/backend/app/services/planning.ts#L198)
- [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L471)
- [restoration_allocations.spec.ts](../../apps/backend/tests/functional/planning/restoration_allocations.spec.ts#L77)
