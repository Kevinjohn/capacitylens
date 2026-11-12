# US-CLI-03 — Archive a client

As an Editor, I want to archive a client so that its work leaves active views while remaining restorable.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Clients screen → client row → Archive {client name}
**Documentation:** [Clients and projects guide](../../docs-src/using/projects.md)
**Source:** [ClientList.tsx](../../apps/frontend/src/components/clients/ClientList.tsx) · [ArchivedEntitySection.tsx](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx)

## Acceptance criteria

- Selecting **Archive {name}** opens **Archive client?** with **Archive** and **Cancel** controls.
- The dialog explains that descendants are hidden and restorable; when descendants exist, it states counts of affected projects, phases and allocations.
- **Cancel** closes the dialog without archiving. **Archive** archives the record.
- The archived record appears in its archived section with a **Restore** control.

## User flow

```mermaid
flowchart TD
  A["Clients screen"] --> B["Archive client row"] --> C["Archive client? confirmation"]
  C -->|Cancel| A
  C -->|Archive| D["Client leaves active list"] --> E["Client appears in Archived clients"]
  C -->|Action refused| F["Notice explains the archive failed"]
```

## Code flow

```mermaid
flowchart TD
  A["ClientList archive confirmation"] --> B["useLifecycleActions.archive"] --> C["sendPlanningCommand: catalogue.archive"]
  C --> D["createPlanningTransport → api.planning.client.archive"] --> E["PlanningController.clientArchive → mutatePlanning begins scoped transaction"]
  E --> F["transitionLifecycle updates only the archived row"] --> K["mutatePlanning records revision/audit and commits"] --> F2["useActiveScopedData activeOnly hides archived ancestry"]
  F2 --> H["ArchivedEntitySection / ArchiveRecoverySection refresh"]
```

**Code references:** [ClientList.tsx](../../apps/frontend/src/components/clients/ClientList.tsx) · [ArchivedEntitySection.tsx](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx) · [ArchiveRecoverySection.tsx](../../apps/frontend/src/components/common/ArchiveRecoverySection.tsx) · [useScopedData.ts](../../apps/frontend/src/store/useScopedData.ts) · [lifecycle.ts](../../packages/shared/src/domain/lifecycle.ts) · [useLifecycleActions.ts](../../apps/frontend/src/hooks/useLifecycleActions.ts) · [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts) · [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts) · [storePlanningTransport.ts](../../apps/frontend/src/data/planning/storePlanningTransport.ts) · [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts) · [planning_routes.ts](../../apps/backend/start/planning_routes.ts) · [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts) · [planning.ts](../../apps/backend/app/services/planning.ts) · [execute.ts](../../apps/backend/app/services/planning/execute.ts)
