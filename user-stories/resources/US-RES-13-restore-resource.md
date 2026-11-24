# US-RES-13 — Restore an archived resource

As an Editor, I want to restore an archived resource so that it returns to active resource views.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner); only Owner/Admin see full inactive data
**Entry:** Resources screen → archived resource row → Restore
**Documentation:** [Resources guide](../../docs-src/using/resources.md)
**Source:** [ResourceList.tsx](../../apps/frontend/src/components/resources/ResourceList.tsx) · [ArchivedEntitySection.tsx](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx)

## Acceptance criteria

- A directly archived resource has an accessible **Restore** control. Selecting it returns the resource to active status and active views.
- A row hidden only by an archived parent reads **Hidden because {type} {name} is archived.** and offers **View archived parent**, which opens the parent’s archived row; restoring the parent reveals descendants that remain active. A row whose parent was permanently deleted reads **Hidden because {type} {name} is deleted.** with no link.

## User flow

```mermaid
flowchart TD
  A["Resources screen"] --> B["Archived resource row"]
  B -->|directly archived| C["Select Restore"] --> D["Resource becomes active"]
  B -->|hidden by archived parent| E["Select View archived parent"] --> F["Parent’s archived row opens; restore the parent there"]
  C -->|Action refused| G["Notice explains the restore failed"]
```

## Code flow

```mermaid
flowchart TD
  ENTRY["ResourceList mounts ArchivedEntitySection"] --> ROLE{"Current company permissions"}
  ROLE -->|Owner or Admin| FULL["PrivilegedArchivedEntitySection → useInactiveCompanyData → includeInactive state read"]
  ROLE -->|Editor| REDACTED["ArchiveRecoverySection → useArchiveRecovery → readArchiveRecovery identities"]
  ROLE -->|Viewer or view-as-member| HIDDEN["No archive recovery controls"]
  FULL --> ROW{"Eligible archived row in this read?"}
  REDACTED --> ROW
  ROW -->|Directly archived, Restore clicked| SEND["useExclusiveOperation → useLifecycleOperations.restore sends resource.restore"]
  ROW -->|Available archived parent link clicked| PARENT["Open parent list at archived row hash"]
  ROW -->|Hidden only by ancestor| ANCESTOR["No Restore on child. Use available parent link"]
  SEND --> SERVER{"mutatePlanning checks planning authorization and revision. transitionLifecycle requires a scoped archived row"}
  SERVER -->|Refused| ERROR["Show error. Planning cache refreshes on conflict"]
  SERVER -->|Accepted| WRITE["Clear archivedAt on target row. Commit revision and audit with projected receipt"]
  WRITE --> NEXT["acceptReceipt refreshes planning. notifyInactiveDataChanged refreshes archive read"]
  NEXT --> RESULT["Resource, eligible bookings and time off return when their dependencies are visible."]
```

The Editor archive read is sensitive and checks `planning:write`; it omits rows with deleted ancestry. The Owner/Admin inactive read checks `members:manage` and projects data for the effective role. An already active row is a server `NO_CHANGE`; a deleted row cannot be restored with this command. `endsHistory` omits the history id. The list renders resource groups in both archive paths. A placeholder hidden by its archived project offers the available parent link. A directly archived placeholder can also be restored while still hidden by that project. The privileged inactive list can show a resolved deleted-parent message. The restored kind must still be enabled to appear in the active roster or Schedule.

**Code references:** [ResourceList.tsx](../../apps/frontend/src/components/resources/ResourceList.tsx#L15) · [Archive access split](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx#L250) · [Editor recovery controls](../../apps/frontend/src/components/common/ArchiveRecoverySection.tsx#L27) · [Editor recovery read](../../apps/backend/app/services/planning_service.ts#L169) · [useInactiveCompanyData.ts](../../apps/frontend/src/hooks/useInactiveCompanyData.ts#L17) · [Inactive state authority](../../apps/backend/app/controllers/company_state_controller.ts#L32) · [Ancestor lookup](../../apps/frontend/src/components/common/archivedEntityRows.ts#L73) · [Editor recovery projection](../../packages/shared/src/domain/lifecycle/archiveRecovery.ts#L25) · [Editor query](../../apps/frontend/src/hooks/useArchiveRecovery.ts#L80) · [Privileged query](../../apps/frontend/src/data/fetchInactiveRecords.ts#L23) · [useLifecycleOperations.ts](../../apps/frontend/src/hooks/useLifecycleOperations.ts#L51) · [planning_execution_service.ts](../../apps/backend/app/services/planning/planning_execution_service.ts#L483) · [projection.ts](../../packages/shared/src/domain/lifecycle/projection.ts#L36) · [sendPlanningIntent](../../apps/frontend/src/store/slices/planningSessionSlice.ts#L139) · [Planning transport](../../apps/frontend/src/data/planning/planningTransport.ts#L64) · [Planning route](../../apps/backend/start/planning_routes.ts#L16) · [Mutation controller](../../apps/backend/app/controllers/planning_mutations_controller.ts#L19) · [Planning transaction](../../apps/backend/app/services/planning_service.ts#L222) · [Company write authority](../../apps/backend/app/services/planning/planning_access_service.ts#L31) · [Receipt and refresh](../../apps/frontend/src/data/planning/planningCache.ts#L469) · [archive_recovery.spec.ts](../../apps/backend/tests/functional/planning/archive_recovery.spec.ts#L353)
