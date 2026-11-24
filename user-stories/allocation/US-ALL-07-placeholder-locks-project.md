# US-ALL-07 — Placeholder assignee locks the project

As an Editor, I want a placeholder’s bound project and activities to stay selected so that placeholder work remains with its planned project.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [AllocationDialog.tsx](../../apps/frontend/src/components/scheduler/AllocationDialog.tsx)

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
  Form["useAllocationTargetState derives options and effective project"] -->|bound placeholder| Lock["AllocationTargetFields limits Project to the bound project"]
  Form -->|unbound placeholder| Open["Project uses ordinary options"]
  Lock --> Match["Project-specific activity or attributed All projects activity"]
  Open --> Match
  Match --> Check["parseAllocationIntentDraft → validateAllocationAssignment"]
  Check -->|project mismatch or unbound with attributed project| Field["Activity error; no request"]
  Check -->|valid changed draft| Commit["commit checks live write access and revision; writeEntity independently checks assertAllocationRefs"]
  Commit -->|committed receipt| Saved["Reconcile projection and close form"]
  Commit -->|refused| Error["Form error, stale refusal refreshes"]
  Commit -->|lost or invalid reply| Unknown["Fetch canonical state with fresh history context"]
```

A bound placeholder leaves the generic Project choices disabled. An unbound placeholder can save projectless work. Save requires an editable, current draft. Cancel and an unchanged edit close without dispatch.

**Code references:**

- [useAllocationTargetState.ts](../../apps/frontend/src/components/scheduler/useAllocationTargetState.ts#L74)
- [useAllocationTargetState.ts](../../apps/frontend/src/components/scheduler/useAllocationTargetState.ts#L162)
- [AllocationTargetFields.tsx](../../apps/frontend/src/components/scheduler/AllocationTargetFields.tsx#L26)
- [allocationDialogSelection.ts](../../apps/frontend/src/components/scheduler/allocationDialogSelection.ts#L28)
- [allocationSubmit.ts](../../apps/frontend/src/components/scheduler/allocationSubmit.ts#L43)
- [refs.ts](../../packages/shared/src/domain/assertions/refs.ts#L366)
- [integrity.ts](../../packages/shared/src/lib/integrity.ts#L126)
- [planning_mutations_controller.ts](../../apps/backend/app/controllers/planning_mutations_controller.ts#L9)
- [planning_service.ts](../../apps/backend/app/services/planning_service.ts#L222)
- [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L471)
- [AllocationDialog.create.test.tsx](../../apps/frontend/src/components/scheduler/AllocationDialog.create.test.tsx#L320)
