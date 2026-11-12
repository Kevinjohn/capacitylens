# US-TOF-06 — Record a named company closure

As an Editor, I want to record a company-wide closure so that people and placeholders share the same unavailable dates.

**Status:** Current
**Access:** Editor, Admin or Owner
**Entry:** Time off page
**Documentation:** [time-off.md](../../docs-src/using/time-off.md)
**Source:** [ClosureForm.tsx](../../apps/frontend/src/components/timeoff/ClosureForm.tsx)

## Acceptance criteria

| Field | Control    | Required/default/conditions                        |
| ----- | ---------- | -------------------------------------------------- |
| Name  | Text input | Required.                                          |
| Start | Date input | Required; defaults to today.                       |
| End   | Date input | Required; defaults to today; cannot precede Start. |

- Save creates the closure; Cancel leaves the schedule unchanged.

## User flow

```mermaid
flowchart TD
  N1["Open Company closures"]
  N2["Add closure"]
  N3["enter a name and date range"]
  N4["Save"]
  N5["closure band affects everyone"]
  B1["Invalid range; field error"]
  B2["Save failure; error shown"]
  B3["Cancel; no closure added"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
  N4 --> N5
  N4 -.-> B1
  N4 -.-> B2
  N1 -.-> B3
```

## Code flow

```mermaid
flowchart TD
  A["ClosureForm: create/edit closure"] --> B["Validate required name and date range"]
  B -->|valid| C["addClosure"]
  B -->|invalid| D["Field error; no write"]
  C --> E["typedPlanningActions.addClosure; planning reconciliation"]
  E --> F["Closure band and availability refresh"]
```

**Code references:**

- [ClosureForm.tsx](../../apps/frontend/src/components/timeoff/ClosureForm.tsx)
- [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts)
- [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts)
