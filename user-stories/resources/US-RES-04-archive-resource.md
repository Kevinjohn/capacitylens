# US-RES-04 — Archive a resource

As an Editor, I want to archive a resource so that it leaves active views while its work remains retained.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → resource row → Archive {resource name}
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [ResourceList.tsx](../../apps/frontend/src/components/resources/ResourceList.tsx) · [ArchivedEntitySection.tsx](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx)

## Acceptance criteria

- Selecting **Archive {name}** opens **Archive resource?** with **Archive** and **Cancel** controls.
- The dialog reads **Archive "{name}"? They will be hidden from the schedule.** and notes that Editors, Admins and Owners can restore them and only Owners and Admins can anonymise them. It shows no count of affected records.
- After confirmation, the resource leaves its active section and the Schedule. Its allocations and time off are kept, not deleted.
- **Cancel** closes the dialog without archiving. **Archive** archives the record.
- The archived record appears in its archived section with a **Restore** control.

## User flow

```mermaid
flowchart TD
  A["Resources screen"] --> B["Archive resource row"] --> C["Archive resource? confirmation"]
  C -->|Cancel| A
  C -->|Archive| D["Resource leaves active section"] --> E["Resource appears in its archived section, such as Archived Studio"]
  C -->|Action refused| F["Notice explains the archive failed"]
```

## Code flow

```mermaid
flowchart TD
  A["ResourceList archive confirmation"] --> B["useLifecycleOperations.archive"] --> C["sendPlanningIntent: resource.archive"]
  C --> D["createPlanningTransport → api.planning.mutate"] --> E["PlanningMutationsController.store → mutatePlanning begins scoped transaction"]
  E --> F["executePlanningIntent.transitionLifecycle updates only the archived row"] --> K["mutatePlanning records revision/audit and commits"] --> F2["useActiveScopedData buildActiveData hides descendants by ancestry"]
  F2 --> H["ArchivedEntitySection / ArchiveRecoverySection refresh"]
```

**Code references:** [ResourceList.tsx](../../apps/frontend/src/components/resources/ResourceList.tsx) · [ArchivedEntitySection.tsx](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx) · [ArchiveRecoverySection.tsx](../../apps/frontend/src/components/common/ArchiveRecoverySection.tsx) · [useLifecycleOperations.ts](../../apps/frontend/src/hooks/useLifecycleOperations.ts) · [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts) · [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts) · [storePlanningTransport.ts](../../apps/frontend/src/data/planning/storePlanningTransport.ts) · [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts) · [planning_routes.ts](../../apps/backend/start/planning_routes.ts) · [planning_mutations_controller.ts](../../apps/backend/app/controllers/planning_mutations_controller.ts) · [planning.ts](../../apps/backend/app/services/planning.ts) · [execute.ts](../../apps/backend/app/services/planning/execute.ts) · [useScopedData.ts](../../apps/frontend/src/store/useScopedData.ts)
