# US-ALL-07 — Placeholder assignee locks the project

As an Editor, I want a placeholder’s bound project and activities to stay selected so that placeholder work remains with its planned project.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx)

## Acceptance criteria

| Field    | Control | Required/default/conditions                                                    |
| -------- | ------- | ------------------------------------------------------------------------------ |
| Project  | Select  | Locked to the selected placeholder’s bound project.                            |
| Activity | Select  | Required; offers compatible activities for the bound project and All projects. |

## User flow

```mermaid
flowchart TD
  N1["Open placeholder resource"]
  N2["project is fixed to its bound project"]
  N3["choose compatible activity"]
  N4["Save"]
  B1["Incompatible activity: correct selection; validation blocks write"]
  B2["Cancel: no allocation change"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
  N3 -.-> B1
  N3 -.-> B2
```

## Code flow

```mermaid
flowchart TD
  A["AllocationTargetFields receives placeholder resource"] --> B["useAllocationTargetState resolves bound project"]
  B --> C["Project control locked; activity options scoped"]
  C --> D["allocationSubmit validates selected assignment"]
  D -->|valid| E["addAllocation or updateAllocation"]
  D -->|invalid| F["Field error; no write"]
```

**Code references:**

- [AllocationTargetFields.tsx](../../apps/frontend/src/components/scheduler/AllocationTargetFields.tsx)
- [useAllocationTargetState.ts](../../apps/frontend/src/components/scheduler/useAllocationTargetState.ts)
- [allocationSubmit.ts](../../apps/frontend/src/components/scheduler/allocationSubmit.ts)
- [refs.ts](../../packages/shared/src/domain/assertions/refs.ts)
