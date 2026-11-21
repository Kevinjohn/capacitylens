# US-DAT-05 — Keep server changes after reload

As a company member, I want saved server changes to persist after reload so that committed work remains available.

**Status:** Current
**Access:** Any authorized company member
**Entry:** Any saved planning edit
**Documentation:** [Settings](../../docs-src/using/settings.md#connection-errors)
**Source:** [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts)

## Acceptance criteria

- A committed server change remains after a reload.
- Stale writes are refused and refreshed for review. A change whose reply was lost is never resent: the schedule shows the server's data and asks the person to check the change.

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
  action["createTypedPlanningActions builds a typed intent"] --> slice["allocationSlice.sendPlanningIntent enters planningCache"]
  slice --> controller["planningCache executes through PlanningTransport"]
  controller --> transport["planningTransport sends the generated planning route"]
  transport --> endpoint["PlanningController validates and calls mutatePlanning"]
  endpoint --> persist["mutatePlanning calls executePlanningIntent and writer in the request transaction"]
  persist --> refresh["Controller refresh reads the canonical planning snapshot"]
  refresh --> reload["Reloaded app reads PlanningController.show into planning state"]
  endpoint --> refusal["Server refusal returns through planningCache to visible planning state"]
```

**Code references:** [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts), [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts), [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts), [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts), [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts), [planning.ts](../../apps/backend/app/services/planning.ts), [execute.ts](../../apps/backend/app/services/planning/execute.ts), [writer.ts](../../apps/backend/app/services/planning/writer.ts)
