# US-ACT-04 — Delete an activity (allocations removed)

**Area:** Activities · **Persona:** Studio manager · **Linked E2E:** `e2e/activities.spec.ts` → "deletes an activity and removes its allocation bars, restorable with undo"

## Goal
Remove an activity and have its allocations (its bars on the schedule) removed with it, restorable via undo.

## Why
When a piece of work is dropped, the manager wants the activity and everything scheduled against it cleared together, not orphaned bars left behind. Since this removes scheduled work, it must be undoable.

## How (end-to-end)
**Precondition:** Seeded app open; click **Activities** in the sidebar (`/activities`). The activity *Wireframes* (`t-wires`) belongs to *Project Lightning* and has allocation bars in June 2026.
1. First, open the **Schedule** (`/`) and **Jump to date** → `2026-06-01` to confirm the *Wireframes* bars are visible.
2. Go to **Activities**. On the **Wireframes** row, click the **Delete** (trash) icon. The "Delete activity?" confirmation dialog opens.
3. Confirm by clicking **Delete**. The dialog closes.
4. Return to the **Schedule** (`/`, **Jump to date** → `2026-06-01`) to inspect.
5. Press **⌘Z** (Undo) to reverse the deletion.

## Acceptance criteria
- ✅ The confirmation dialog is titled **Delete activity?**.
- ✅ After confirming, **Wireframes** is gone from the Activities list.
- ✅ The allocation bars for **Wireframes** are gone from the schedule.
- ✅ Other activities of *Project Lightning* (*Visual Design*, *CMS Review*) and their bars are untouched; the project and its client are untouched.
- ✅ Pressing **⌘Z** restores the **Wireframes** activity and its allocation bars.
