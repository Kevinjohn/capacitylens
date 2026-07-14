# US-SET-08 — Clear device data

**Area:** Settings · **Persona:** User · **Linked E2E:** `e2e/clear-local-storage.spec.ts`

## Goal

Remove CapacityLens preferences and opt-in offline snapshots from this browser without deleting
server data.

## Acceptance

- Settings shows **Clear device data** (`data-testid="clear-local-storage"`).
- The confirmation says it affects this browser and cannot be undone.
- Cancel changes nothing.
- Confirm clears the current user's offline cache and CapacityLens-prefixed preferences, leaves
  unrelated origin keys and the server database untouched, then reloads.
