# US-ALL-03 — Duplicate an allocation

As an Editor, I want to duplicate an allocation so that I can reuse its resource, activity and dates without re-entering them.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx)

## Acceptance criteria

- **Duplicate** creates an independent copy of an eligible allocation.
- Undo removes the copy; the original remains unchanged.

## User flow

```mermaid
flowchart TD
  N1["Open an eligible allocation"]
  N2["choose Duplicate"]
  N3["review copied fields"]
  N4["confirm"]
  N5["independent copy appears"]
  B1["Invalid draft or write error ; then  form reports error; original is unchanged"]
  B2["Cancel/close ; then  no copy"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
  N4 --> N5
  N4 -.-> B1
  N4 -.-> B2
```

## Code flow

```mermaid
flowchart TD
  A["AllocationModal edit footer: Duplicate"] --> B["allocationSubmit duplicateAllocation validates draft"]
  B -->|valid| C["allocationSlice.duplicateAllocation(source id, draft)"]
  B -->|invalid| D["Field error; no copy"]
  C --> E["allocationSlice typed write and reconciliation"]
  E -->|created| F["Close dialog; independent copy rendered"]
  E -->|failure| G["Form error; original remains"]
```

**Code references:**

- [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx)
- [AllocationFooter.tsx](../../apps/frontend/src/components/scheduler/AllocationFooter.tsx)
- [allocationSubmit.ts](../../apps/frontend/src/components/scheduler/allocationSubmit.ts)
- [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts)
- [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts)
