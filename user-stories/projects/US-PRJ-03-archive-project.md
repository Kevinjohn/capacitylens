# US-PRJ-03 — Archive a project

As an Editor, I want to archive a project so that its work leaves active views while remaining restorable.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Projects screen → project row → Archive {project name}
**Documentation:** [Guide](../../docs-src/using/projects.md)
**Source:** [ProjectList.tsx](../../apps/frontend/src/components/projects/ProjectList.tsx) · [ArchivedEntitySection.tsx](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx)

## Acceptance criteria

- Selecting **Archive {name}** opens **Archive project?** with **Archive** and **Cancel** controls.
- The dialog explains that phases and allocations are hidden and restorable, and states no count. After **Archive**, a notice reports the hidden phases and allocations when there are any.
- **Cancel** closes the dialog without archiving. **Archive** archives the record.
- The archived record appears in its archived section with a **Restore** control.

## User flow

```mermaid
flowchart TD
  A["Projects screen"] --> B["Archive project row"] --> C["Archive project? confirmation"]
  C -->|Cancel| A
  C -->|Archive| D["Project leaves active list"] --> E["Project appears in Archived projects"]
  C -->|Action refused| F["Notice explains the archive failed"]
```

## Code flow

```mermaid
flowchart TD
  ENTRY["ProjectList archive button opens ConfirmDialog"] --> CHOICE{"Confirmation action"}
  CHOICE -->|Cancel| CLOSE["Close dialog"]
  CHOICE -->|Archive| SEND["useLifecycleOperations.archive for projects sends catalogue.archive and closes dialog immediately"]
  SEND --> SERVER{"mutatePlanning checks planning authority and revision. transitionLifecycle requires an active scoped row"}
  SERVER -->|Refused| ERROR["Show error. Planning cache refreshes on conflict"]
  SERVER -->|Accepted| WRITE["Set archivedAt on the target row. Commit revision and audit with projected receipt"]
  WRITE --> NEXT["acceptReceipt refreshes active data. Active projection hides dependent phases, activities, placeholders and bookings."]
  NEXT --> IMPACT["buildArchiveImpactNotice displays nonzero counts from receipt.archived"]
```

Owner, Admin and Editor can write planning data. Viewer and view-as-member lack write authority. Archive data is read through the Editor recovery section or the Owner/Admin inactive section. The active projection determines descendant visibility from retained links. `useLifecycleOperations` skips dispatch after a company change. `endsHistory` omits the history id and `notifyInactiveDataChanged` refreshes the inactive list. The list offers Restore for reversal. The transaction archives only the project row. Its active projection also hides All projects bookings attributed to this project. The optional receipt notice reports newly hidden phases and allocations.

**Code references:** [ProjectList.tsx](../../apps/frontend/src/components/projects/ProjectList.tsx#L69) · [dialogs.tsx](../../apps/frontend/src/components/common/dialogs.tsx#L202) · [useLifecycleOperations.ts](../../apps/frontend/src/hooks/useLifecycleOperations.ts#L51) · [execute.ts](../../apps/backend/app/services/planning/execute.ts#L65) · [projection.ts](../../packages/shared/src/domain/lifecycle/projection.ts#L36) · [sendPlanningIntent](../../apps/frontend/src/store/slices/planningSessionSlice.ts#L139) · [Planning transport](../../apps/frontend/src/data/planning/planningTransport.ts#L64) · [Planning route](../../apps/backend/start/planning_routes.ts#L16) · [Mutation controller](../../apps/backend/app/controllers/planning_mutations_controller.ts#L9) · [Planning transaction](../../apps/backend/app/services/planning.ts#L198) · [Company write authority](../../apps/backend/app/services/planning/access.ts#L16) · [Receipt and refresh](../../apps/frontend/src/data/planning/planningCache.ts#L469) · [Archive access split](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx#L250) · [Editor recovery controls](../../apps/frontend/src/components/common/ArchiveRecoverySection.tsx#L27) · [Editor recovery read](../../apps/backend/app/services/planning.ts#L135) · [useInactiveCompanyData.ts](../../apps/frontend/src/hooks/useInactiveCompanyData.ts#L17) · [Inactive state authority](../../apps/backend/app/controllers/company_state_controller.ts#L13) · [Ancestor lookup](../../apps/frontend/src/components/common/archivedEntityRows.ts#L73) · [Editor recovery projection](../../packages/shared/src/domain/lifecycle/archiveRecovery.ts#L25) · [impact.ts](../../packages/shared/src/domain/lifecycle/impact.ts#L45) · [ProjectList.tsx](../../apps/frontend/src/components/projects/ProjectList.tsx#L123) · [archiveImpactCopy.ts](../../apps/frontend/src/lib/archiveImpactCopy.ts#L14)
