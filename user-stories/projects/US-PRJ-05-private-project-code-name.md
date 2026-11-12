# US-PRJ-05 — Mark a project private with a code name

As an Owner, I want to set a project code name so that non-Owners see the safe name while Owners retain the real name.

**Status:** Current
**Access:** Editor and above for ordinary fields; Owner only for privacy and code-name fields
**Entry:** Projects screen → project row → Edit (Owner only for private fields)
**Documentation:** [Guide](../../docs-src/using/projects.md)
**Source:** [ProjectList.tsx](../../apps/frontend/src/components/projects/ProjectList.tsx) · [ProjectForm.tsx](../../apps/frontend/src/components/projects/ProjectForm.tsx)

## Acceptance criteria

| Field         | Control         | Required/default/conditions                                          |
| ------------- | --------------- | -------------------------------------------------------------------- |
| Client        | Picker          | Required; Internal first, then active clients by name                |
| Name          | Text field      | Required; read-only for non-Owners when the project uses a code name |
| Use code name | Switch          | Owner only; current value prefilled                                  |
| Code name     | Text field      | Owner only; shown and required when Use code name is on              |
| Colour        | Preset swatches | Current colour preselected; hidden when the client is Internal       |

- **Save** updates the real name or code name. Non-Owners continue to see the code name. Missing code name keeps the form open with an error. **Cancel** closes without saving.

## User flow

```mermaid
flowchart TD
  A["Projects screen"] --> B["Owner edits project"] --> C["Turn on Use code name"] --> D["Enter Code name"]
  B --> Z["Cancel closes without saving"]
  D -->|Save valid| E["Owner sees real name; other roles see code name"]
  D -->|blank or invalid| F["Form stays open with error"]
  C --> G["Turn privacy off and Save"] --> H["Code name is removed"]
```

## Code flow

```mermaid
flowchart TD
  A["ProjectForm.useProjectSubmit → parsePrivacyPatch"] --> B["useStore.updateProject → createTypedPlanningActions.updateProject"]
  B --> C["updateCatalogue → allocationSlice.send"]
  C --> D["createPlanningCacheController.execute"] --> E{"createStorePlanningTransport"}
  E --> F["createPlanningTransport.sendOperation → api.planning.project.update"] --> G["PlanningController.projectUpdate → mutatePlanning begins the scoped transaction"]
  G --> H["executePlanningIntent applies intent → writeRow persists row"] --> K["mutatePlanning records revision/audit and commits"] --> J["acceptReceipt updates planning state; ProjectList renders"]
```

**Code references:** [ProjectForm.tsx](../../apps/frontend/src/components/projects/ProjectForm.tsx) · [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts) · [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts) · [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts) · [storePlanningTransport.ts](../../apps/frontend/src/data/planning/storePlanningTransport.ts) · [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts) · [planning_routes.ts](../../apps/backend/start/planning_routes.ts) · [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts) · [planning.ts](../../apps/backend/app/services/planning.ts) · [execute.ts](../../apps/backend/app/services/planning/execute.ts) · [usePrivateNameFields.ts](../../apps/frontend/src/components/common/usePrivateNameFields.ts) · [PrivateNameFields.tsx](../../apps/frontend/src/components/common/PrivateNameFields.tsx) · [writer.ts](../../apps/backend/app/services/planning/writer.ts)
