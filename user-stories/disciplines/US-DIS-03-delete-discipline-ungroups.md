# US-DIS-03 — Delete a discipline (resources ungrouped, not deleted)

**Area:** Disciplines · **Persona:** Studio manager · **Linked E2E:** `e2e/disciplines.spec.ts` → "deletes a discipline and ungroups its resources without deleting them"

## Goal
Remove a discipline the studio no longer uses, keeping its resources but moving them out of any group (to "No discipline").

## Why
Reorganising the team should never cost you people. Deleting a discipline is intentionally **non-destructive**: the category disappears but everyone in it stays schedulable, just ungrouped, until reassigned. The manager needs reassurance of this before confirming, and an undo if they change their mind.

## How (end-to-end)
**Precondition:** Seeded app open; click **Disciplines** in the sidebar (`/disciplines`). *Design* groups *Tyler Nix* and the *Senior Designer* placeholder.
1. On the **Design** row, click **Delete**. The "Delete discipline?" confirmation dialog opens.
2. Read the dialog: it states that the discipline's resources will be **ungrouped (moved to "No discipline"), not deleted**.
3. Click **Delete** to confirm. The dialog closes.
4. Click **Schedule** in the sidebar (`/`); use **Jump to date** → `2026-06-01` to see the seed bars.
5. Press **⌘Z** (Undo) to reverse the deletion.

## Acceptance criteria
- ✅ The confirmation dialog is titled **Delete discipline?** and clearly states the resources will be **ungrouped, not deleted**.
- ✅ After confirming, the **Design** discipline is gone from the Disciplines list and from the schedule grouping (no Design group header).
- ✅ **Tyler Nix** and the **Senior Designer** placeholder still exist as resources — they now appear under a **No discipline** group on the schedule, not removed.
- ✅ Tyler's existing allocations and the placeholder's binding are untouched (only the grouping changed).
- ✅ Pressing **⌘Z** restores the **Design** discipline and re-groups Tyler and the placeholder under it.
