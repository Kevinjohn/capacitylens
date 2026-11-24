# US-TOF-03 — Delete a time-off entry (confirmed)

As an Editor, I want to confirm before deleting time off so that an accidental removal can be cancelled.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Time off page

**Documentation:** [time-off.md](../../docs-src/using/time-off.md)

**Source:** [TimeOffForm.tsx](../../apps/frontend/src/components/time-off/TimeOffForm.tsx)

## Acceptance criteria

- **Delete {name} time off from {start} to {end}** opens **Delete time off?** (“Remove this time-off entry?”) with **Delete** and **Cancel**; Cancel preserves the entry.
- Confirming Delete removes the entry from the list and Schedule.

## User flow

```mermaid
flowchart TD
  N1["Choose Delete on a time-off entry"]
  N2["confirmation appears"]
  B1["Cancel: keep entry"]
  B2["Confirm Delete: remove entry from list and schedule"]
  N1 --> N2
  N1 -.-> B1
  N1 -.-> B2
```

## Code flow

```mermaid
flowchart TD
  Row["TimeOffList Delete for planning writers"] --> Prompt["ConfirmDialog for selected entry"]
  Prompt -->|Cancel or Escape before confirming| Close["Dismiss prompt"]
  Prompt -->|confirm| Send["useConfirmDelete awaits deleteTimeOff"]
  Send -->|row already missing locally or viewer guard| Close
  Send --> Commit["timeOff.delete checks live write access and revision; deleteRows retains one restoration group"]
  Commit -->|committed and reconciled| Close
  Commit -->|known refusal| Error["Error notice; prompt stays mounted"]
  Commit -->|lost or invalid reply| Uncertain["Canonical read can remove row; request still reports error"]
  Uncertain --> Error
  Error -->|confirm again| Send
  Error -->|Cancel or Escape| Held["confirmingRef suppresses onCancel"]
```

An eligible Undo restores that individual row. The mounted prompt suppresses dismissal after a failed confirmed request, including a stale refusal that caused a refetch.

**Code references:**

- [TimeOffList.tsx](../../apps/frontend/src/components/time-off/TimeOffList.tsx#L171)
- [dialogs.tsx](../../apps/frontend/src/components/common/dialogs.tsx#L219)
- [useConfirmDelete.ts](../../apps/frontend/src/hooks/useConfirmDelete.ts#L4)
- [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts#L288)
- [execute.ts](../../apps/backend/app/services/planning/execute.ts#L395)
- [planning_mutations_controller.ts](../../apps/backend/app/controllers/planning_mutations_controller.ts#L9)
- [planning.ts](../../apps/backend/app/services/planning.ts#L198)
- [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L471)
- [TimeOffList.test.tsx](../../apps/frontend/src/components/time-off/TimeOffList.test.tsx#L283)
