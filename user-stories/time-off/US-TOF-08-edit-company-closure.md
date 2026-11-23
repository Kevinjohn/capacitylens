# US-TOF-08 — Edit a company closure

As an Editor, I want to update a company closure so that its name and dates reflect the current company calendar.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Time off page, Company closures section

**Documentation:** [time-off.md](../../docs-src/using/time-off.md)

**Source:** [ClosureForm.tsx](../../apps/frontend/src/components/time-off/ClosureForm.tsx)

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
  B1["Invalid range or save error: show error; keep form open"]
  B2["Cancel: original closure remains"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
  N3 -.-> B1
  N3 -.-> B2
```

## Code flow

```mermaid
flowchart TD
  Row["ClosureItems Edit for planning writers"] --> Form["ClosureForm prefills opening row"]
  Form -->|Cancel| Close["Dismiss form"]
  Form --> Check["useEditSubmit runs prepareSave before checking opening row"]
  Check -->|invalid| Field["Field error"]
  Check -->|stale row| Stale["Stale form error; close and reopen"]
  Check -->|valid and current| Diff["updateClosure → buildClosureUpdate"]
  Diff -->|no diff| Close
  Diff -->|changes| Send["closure.update carries expectedUpdatedAt; disable pending controls"]
  Send --> Commit["commit checks live write access and revision; writeEntity checks row timestamp and fields"]
  Commit -->|committed and reconciled| List["Close; buildClosureList may omit changed span"]
  Commit -->|known refusal| Error["Form error; release pending guard; stale refusal refreshes"]
  Commit -->|lost or invalid reply| Unknown["Canonical read may show edited closure; no replay"]
```

**Code references:**

- [CompanyClosureSection.tsx](../../apps/frontend/src/components/time-off/CompanyClosureSection.tsx#L38)
- [ClosureForm.tsx](../../apps/frontend/src/components/time-off/ClosureForm.tsx#L74)
- [ClosureForm.tsx](../../apps/frontend/src/components/time-off/ClosureForm.tsx#L103)
- [useEditSubmit.ts](../../apps/frontend/src/hooks/useEditSubmit.ts#L44)
- [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts#L308)
- [planningIntents.ts](../../apps/frontend/src/data/planning/planningIntents.ts#L292)
- [entity_write.ts](../../apps/backend/app/services/planning/entity_write.ts#L111)
- [timeOffView.ts](../../apps/frontend/src/components/time-off/timeOffView.ts#L24)
- [planning_mutations_controller.ts](../../apps/backend/app/controllers/planning_mutations_controller.ts#L7)
- [planning.ts](../../apps/backend/app/services/planning.ts#L198)
- [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L471)
