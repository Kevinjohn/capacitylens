# US-DAT-05 — Keep server changes after reload

As a company member, I want saved server changes to persist after reload so that committed work remains available.

**Status:** Current
**Access:** Any authorized company member
**Entry:** Any saved planning edit
**Documentation:** [Settings](../../docs-src/using/settings.md#connection-errors)
**Source:** [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts)

## Acceptance criteria

- A committed server change remains after a reload.
- Stale writes are refused and refreshed for review; uncertain outcomes are checked before retry.

## User flow

```mermaid
flowchart TD
  edit["Make a planning edit in the server app"] --> save["Save"]
  save --> refused["Refused: see the reason and review the edit"]
  save --> accepted["Accepted: refreshed company data shows the edit"]
  accepted --> reload["Reload → committed edit remains"]
```

## Code flow

```mermaid
flowchart TD
  action["createTypedPlanningActions builds a typed command"] --> slice["allocationSlice.sendPlanningCommand enters planningCacheController"]
  slice --> controller["planningCacheController executes through PlanningTransport"]
  controller --> transport["planningTransport sends the generated planning route"]
  transport --> endpoint["PlanningController validates and calls mutatePlanning"]
  endpoint --> persist["mutatePlanning calls executePlanningIntent and writer in the request transaction"]
  persist --> refresh["Controller refresh reads the canonical planning snapshot"]
  refresh --> reload["Reloaded app reads PlanningController.show into planning state"]
  endpoint --> refusal["Server refusal returns through planningCacheController to visible planning state"]
```

**Code references:** [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts), [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts), [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts), [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts), [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts), [planning.ts](../../apps/backend/app/services/planning.ts), [execute.ts](../../apps/backend/app/services/planning/execute.ts), [writer.ts](../../apps/backend/app/services/planning/writer.ts)
