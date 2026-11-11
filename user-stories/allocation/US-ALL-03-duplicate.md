# US-ALL-03 — Duplicate an allocation

As an Editor, I want to duplicate an allocation so that I can reuse its resource, activity and dates without re-entering them.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx)

## Acceptance criteria

- The Edit allocation dialog shows **Duplicate** only for an allocation that is not part of a repeating series.
- **Duplicate** immediately creates a separate allocation from the form’s current values and closes the dialog; the original allocation keeps its saved values.
- An invalid form or a refused save keeps the dialog open with an error and creates no copy. Undo removes a created copy.

## User flow

```mermaid
flowchart TD
  N1["Open an allocation that is not part of a repeating series"]
  N2["optionally adjust the form"]
  N3["choose Duplicate"]
  N4["a separate copy appears; the dialog closes"]
  B1["Invalid form or refused save: error shown, no copy created"]
  B2["Cancel: no copy"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
  N3 -.-> B1
  N2 -.-> B2
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
