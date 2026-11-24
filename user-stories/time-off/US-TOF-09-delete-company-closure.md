# US-TOF-09 — Delete a company closure

As an Editor, I want to remove a company closure so that its dates no longer reduce available capacity.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Time off page, Company closures section

**Documentation:** [time-off.md](../../docs-src/using/time-off.md)

**Source:** [CompanyClosureSection.tsx](../../apps/frontend/src/components/time-off/CompanyClosureSection.tsx)

## Acceptance criteria

- **Delete {name} closure, {range}** opens **Delete closure?** (“Remove this company closure?”) with **Delete** and **Cancel**; Cancel keeps the closure.
- Confirming Delete removes the closure band and restores availability on its dates.

## User flow

```mermaid
flowchart TD
  N1["Choose Delete on a company closure"]
  N2["confirmation appears"]
  B1["Cancel: keep closure"]
  B2["Confirm: closure band is removed and capacity recalculates"]
  N1 --> N2
  N1 -.-> B1
  N1 -.-> B2
```

## Code flow

```mermaid
flowchart TD
  Row["ClosureItems Delete for planning writers"] --> Prompt["ConfirmDialog for selected closure"]
  Prompt -->|Cancel or Escape before confirming| Close["Dismiss prompt"]
  Prompt -->|confirm| Send["useConfirmDelete awaits deleteClosure"]
  Send -->|row already missing locally or viewer guard| Close
  Send --> Commit["closure.delete checks live write access and revision; deleteRows retains one restoration group"]
  Commit -->|committed and reconciled| Capacity["Close and recompute capacity for remaining closures, absences and working days"]
  Commit -->|known refusal| Error["Show error notice; prompt stays mounted"]
  Commit -->|lost or invalid reply| Uncertain["Canonical read can remove closure; request still reports error"]
  Uncertain --> Error
  Error -->|confirm again| Send
  Error -->|Cancel or Escape| Held["confirmingRef suppresses onCancel"]
```

**Code references:**

- [CompanyClosureSection.tsx](../../apps/frontend/src/components/time-off/CompanyClosureSection.tsx#L114)
- [dialogs.tsx](../../apps/frontend/src/components/common/dialogs.tsx#L219)
- [useConfirmDelete.ts](../../apps/frontend/src/hooks/useConfirmDelete.ts#L4)
- [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts#L326)
- [planning_execution_service.ts](../../apps/backend/app/services/planning/planning_execution_service.ts#L389)
- [availability.ts](../../packages/shared/src/lib/capacity/availability.ts#L92)
- [planning_mutations_controller.ts](../../apps/backend/app/controllers/planning_mutations_controller.ts#L9)
- [planning_service.ts](../../apps/backend/app/services/planning_service.ts#L222)
- [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L471)
- [CompanyClosureSection.test.tsx](../../apps/frontend/src/components/time-off/CompanyClosureSection.test.tsx#L109)
