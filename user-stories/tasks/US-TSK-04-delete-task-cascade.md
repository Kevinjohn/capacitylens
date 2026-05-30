# US-TSK-04 — Delete a task (allocations removed)

**Area:** Tasks · **Persona:** Studio manager · **Linked E2E:** `e2e/tasks.spec.ts` → "deletes a task and removes its allocation bars, restorable with undo"

## Goal
Remove a task and have its allocations (its bars on the schedule) removed with it, restorable via undo.

## Why
When a piece of work is dropped, the manager wants the task and everything scheduled against it cleared together, not orphaned bars left behind. Since this removes scheduled work, it must be undoable.

## How (end-to-end)
**Precondition:** Seeded app open; click **Tasks** in the sidebar (`/tasks`). The task *Wireframes* (`t-wires`) belongs to *Project Lightning* and has allocation bars in June 2026.
1. First, open the **Schedule** (`/`) and **Jump to date** → `2026-06-01` to confirm the *Wireframes* bars are visible.
2. Go to **Tasks**. On the **Wireframes** row, click **Delete**. The "Delete task?" confirmation dialog opens.
3. Confirm by clicking **Delete**. The dialog closes.
4. Return to the **Schedule** (`/`, **Jump to date** → `2026-06-01`) to inspect.
5. Press **⌘Z** (Undo) to reverse the deletion.

## Acceptance criteria
- ✅ The confirmation dialog is titled **Delete task?**.
- ✅ After confirming, **Wireframes** is gone from the Tasks list.
- ✅ The allocation bars for **Wireframes** are gone from the schedule.
- ✅ Other tasks of *Project Lightning* (*Visual Design*, *CMS Review*) and their bars are untouched; the project and its client are untouched.
- ✅ Pressing **⌘Z** restores the **Wireframes** task and its allocation bars.
