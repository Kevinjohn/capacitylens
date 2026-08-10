# US-ACT-04 — Delete an activity (allocations removed)

**Area:** Activities · **Persona:** Studio manager · **Linked E2E:** `e2e/activities.spec.ts` → "deletes an activity and removes its allocation bars, restorable with undo"

## Goal

Remove an activity and have its allocations (its bars on the schedule) removed with it, restorable via undo.

## Why

When a piece of work is dropped, the manager wants the activity and everything scheduled against it cleared together, not orphaned bars left behind. Since this removes scheduled work, it must be undoable.

## How (end-to-end)

**Precondition:** Seeded app open; click **Activities** in the sidebar (`/activities`). The activity _Wireframes_ (`t-wires`) belongs to _Project Watchtower_ and has allocation bars in June 2026.

1. First, open the **Schedule** (`/`) and click **Today** to confirm the _Wireframes_ bars are visible.
2. Go to **Activities**. On the **Wireframes** row, click the **Delete** (trash) icon. The "Delete activity?" confirmation dialog opens.
3. Confirm by clicking **Delete**. The dialog closes.
4. Return to the **Schedule** (`/`, click **Today**) to inspect.
5. Press **⌘Z** (Undo) to reverse the deletion.

## Acceptance criteria

- ✅ The confirmation dialog is titled **Delete activity?**.
- ✅ After confirming, **Wireframes** is gone from the Activities list.
- ✅ The allocation bars for **Wireframes** are gone from the schedule.
- ✅ Other activities of _Project Watchtower_ (_Visual Design_, _CMS Review_) and their bars are untouched; the project and its client are untouched.
- ✅ Pressing **⌘Z** restores the **Wireframes** activity and its allocation bars.
