# US-DAT-05 — Keep server changes after reload

As a company member, I want saved server changes to persist after reload so that committed work remains available.

**Status:** Current
**Access:** Any authorised company member
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
  draft["Typed planning action supplies the intent to planningSessionSlice.sendPlanningIntent"] --> cacheWrite["Check write availability, then execute through planningCache"]
  cacheWrite --> send["planningTransport sends the planning mutation"]
  send --> server["PlanningMutationsController invokes the authorized mutatePlanning transaction"]
  server -->|Commit| receipt["acceptReceipt validates the receipt and applies its rows if its base matches the cache"]
  receipt -->|Valid| read["Read authoritative planning state and server history"]
  receipt -->|Invalid| unknown["settleUnconfirmed rotates page history, clears undo availability and never resends"]
  server -->|Stale conflict| stale["Mark refusal and reread without replay"]
  stale --> read
  server -->|Ordinary denial or validation refusal| refuse["Keep visible refusal"]
  send -->|Unknown commit| unknown
  unknown --> read
  read -->|Recovered after unknown result| check["Ask the person to check the change before trying again"]
  read -->|Failed| retryRead["Show planning read error"]
  reload["Page reload starts a new page history"] --> snapshot["PlanningController.show reads persisted company state for an authorized effective member"]
  snapshot --> cache["Hydrate planningCache"]
```

**Code references:** [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts#L87) · [planningSessionSlice.ts](../../apps/frontend/src/store/slices/planningSessionSlice.ts#L139) · [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L469) · [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L525) · [planning_service.ts](../../apps/backend/app/services/planning_service.ts#L270) · [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts#L9) · [planning_access_service.ts](../../apps/backend/app/services/planning/planning_access_service.ts#L31) · [dev-fullstack.mjs](../../scripts/dev/dev-fullstack.mjs#L124)
