# US-ALL-06 — Change an allocation's assignee

As an Editor, I want to change an allocation’s assignee so that work can move to the resource who will do it.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx)

## Acceptance criteria

| Field    | Control | Required/default/conditions                                                                                                 |
| -------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| Assignee | Select  | Required; prefilled with the current resource. The other edit fields remain as described in [US-ALL-02](US-ALL-02-edit.md). |

## User flow

```mermaid
flowchart TD
  N1["Open allocation"]
  N2["choose another assignee"]
  N3["Save"]
  N4["booking moves to that resource"]
  B1["Invalid placement or save error ; then  form stays open with error"]
  B2["Cancel ; then  original assignee remains"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
  N3 -.-> B1
  N3 -.-> B2
```

## Code flow

```mermaid
flowchart TD
  A["AllocationModal edit"] --> B["AllocationTargetFields: assignee selection"]
  B --> C["useAllocationModalState: resolve selected resource"]
  C --> D["allocationSubmit validates assignment and placement"]
  D -->|valid| E["updateAllocation with new resourceId"]
  D -->|invalid| F["Resource/activity error; no write"]
  E --> G["allocationSlice planning reconciliation updates Schedule row"]
```

**Code references:**

- [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx)
- [AllocationTargetFields.tsx](../../apps/frontend/src/components/scheduler/AllocationTargetFields.tsx)
- [useAllocationModalState.ts](../../apps/frontend/src/components/scheduler/useAllocationModalState.ts)
- [allocationSubmit.ts](../../apps/frontend/src/components/scheduler/allocationSubmit.ts)
- [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts)
