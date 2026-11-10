# US-TOF-08 — Edit a company closure

As an Editor, I want to update a company closure so that its name and dates reflect the current company calendar.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Time off page, Company closures section

**Documentation:** [time-off.md](../../docs-src/using/time-off.md)

**Source:** [ClosureForm.tsx](../../apps/frontend/src/components/timeoff/ClosureForm.tsx)

## Acceptance criteria

| Field | Control    | Required/default/conditions                                        |
| ----- | ---------- | ------------------------------------------------------------------ |
| Name  | Text input | Required; prefilled with the saved name.                           |
| Start | Date input | Required; prefilled with the saved start date.                     |
| End   | Date input | Required; prefilled with the saved end date; cannot precede Start. |

- Save updates the closure; Cancel leaves it unchanged.

## User flow

```mermaid
flowchart TD
  N1["Open a company closure"]
  N2["edit its name or dates"]
  N3["Save"]
  N4["closure band updates"]
  B1["Invalid range or save error ; then  show error; keep form open"]
  B2["Cancel ; then  original closure remains"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
  N3 -.-> B1
  N3 -.-> B2
```

## Code flow

```mermaid
flowchart TD
  A["ClosureForm: create/edit closure"] --> B["Validate required name and date range"]
  B -->|valid| C["updateClosure"]
  B -->|invalid| D["Field error; no write"]
  C --> E["typedPlanningActions.updateClosure; planning reconciliation"]
  E --> F["Closure band and availability refresh"]
```

**Code references:**

- [ClosureForm.tsx](../../apps/frontend/src/components/timeoff/ClosureForm.tsx)
- [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts)
- [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts)
