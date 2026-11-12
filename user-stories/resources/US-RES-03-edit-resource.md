# US-RES-03 — Edit a resource's fields

As an Editor, I want to edit a resource’s details so that the roster and schedule stay accurate.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → resource row → Edit
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [ResourceList.tsx](../../apps/frontend/src/components/resources/ResourceList.tsx) · [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx) · [ResourceAvailabilityFields.tsx](../../apps/frontend/src/components/resources/ResourceAvailabilityFields.tsx)

## Acceptance criteria

| Field                 | Control          | Required/default/conditions                                                                         |
| --------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| Name                  | Text field       | Current value prefilled; required for people, optional for placeholders                             |
| Role                  | Text field       | Current value prefilled; optional                                                                   |
| Discipline            | Picker           | Current value prefilled; shown when disciplines are enabled and at least one exists                 |
| Engagement            | Segmented choice | People only; current value prefilled, Studio or Supplementary                                       |
| Bound project         | Picker           | Placeholders only; current project prefilled and required                                           |
| Start date / End date | Date fields      | People only; current values prefilled; optional and inclusive; End date cannot be before Start date |
| Working days          | Weekday picker   | People only; current values prefilled; at least one weekday Full day or Half day                    |

- **Save** updates the resource with the selected kind-specific fields; invalid required values keep the form open with an error. **Cancel** closes without saving.

## User flow

```mermaid
flowchart TD
  A["Resources screen"] --> B["Edit person or placeholder"] --> C["Change fields shown for its kind"] --> D["Save"]
  D -->|valid| E["Updated resource appears in list and schedule"]
  D -->|invalid| F["Form stays open with error"]
  C --> G["Cancel"] --> H["Form closes without saving"]

  D -->|server refuses save| X["Error stays visible in the form"]
```

## Code flow

```mermaid
flowchart TD
  A["ResourceForm.useResourceSubmit.createSubmit"] --> B["useStore.updateResource → createTypedPlanningActions.updateResource"]
  B --> C["buildResourceUpdate → allocationSlice.send"]
  C --> D["createPlanningCacheController.execute"] --> E{"createStorePlanningTransport"}
  E --> F["createPlanningTransport.sendOperation → api.planning.resource.update"] --> G["PlanningController.resourceUpdate → mutatePlanning begins the scoped transaction"]
  G --> H["executePlanningIntent applies intent → writeRow persists row"] --> K["mutatePlanning records revision/audit and commits"] --> J["acceptReceipt updates planning state; ResourceList renders"]
```

**Code references:** [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx) · [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts) · [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts) · [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts) · [storePlanningTransport.ts](../../apps/frontend/src/data/planning/storePlanningTransport.ts) · [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts) · [planning_routes.ts](../../apps/backend/start/planning_routes.ts) · [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts) · [planning.ts](../../apps/backend/app/services/planning.ts) · [execute.ts](../../apps/backend/app/services/planning/execute.ts) · [writer.ts](../../apps/backend/app/services/planning/writer.ts) · [useResourceSubmit.ts](../../apps/frontend/src/components/resources/useResourceSubmit.ts)
