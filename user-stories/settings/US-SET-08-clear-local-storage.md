# US-SET-08 — Clear device data

**Area:** Settings · **Persona:** User · **Linked E2E:** `e2e/clear-local-storage.spec.ts`

## Goal

Remove CapacityLens preferences and opt-in offline snapshots from this browser without deleting
server data.

## Why

A user needs one explicit recovery/privacy boundary for device-owned state without confusing it
with deletion of the company schedule held by the server.

## How (end-to-end)

**Precondition:** Settings open with at least one CapacityLens preference, an opt-in offline cache
entry, and an unrelated origin-storage key present.

1. Click **Clear device data** (`data-testid="clear-local-storage"`).
2. Read the confirmation, then click **Cancel** and verify all device data remains.
3. Open the confirmation again and click **Clear device data**.
4. After the automatic reload, inspect browser-owned storage and reopen the selected company.

## Acceptance criteria

- ✅ Settings shows **Clear device data** (`data-testid="clear-local-storage"`).
- ✅ The confirmation says it affects this browser and cannot be undone.
- ✅ Cancel changes nothing.
- ✅ Confirm clears the current user's offline cache and CapacityLens-prefixed preferences, leaves
  unrelated origin keys and the server database untouched, then reloads.
