# US-ALL-11 — Cancel allocation create or edit

As an Editor, I want to cancel an allocation form so that an unsaved draft is discarded.

**Status:** Current
**Access:** Editor, Admin or Owner
**Entry:** New allocation or Edit allocation dialog
**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)
**Source:** [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx)

## Acceptance criteria

- **Cancel** or the close control closes the dialog without creating or changing an allocation.

## User flow

```mermaid
flowchart TD
  N1["Open create or edit allocation form"]
  N2["change draft"]
  N3["Cancel or close"]
  N4["dialog closes and schedule remains as before"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
```

## Code flow

```mermaid
flowchart TD
  A["AllocationModal onClose"] --> B["useAllocationModalState close handler"]
  B --> C["Clear local form state and close dialog"]
  C --> D["No addAllocation or updateAllocation call"]
  D --> E["Existing Schedule data remains unchanged"]
```

**Code references:**

- [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx)
- [useAllocationModalState.ts](../../apps/frontend/src/components/scheduler/useAllocationModalState.ts)
