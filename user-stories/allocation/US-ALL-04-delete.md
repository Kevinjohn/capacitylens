# US-ALL-04 — Delete an allocation

**Area:** Allocation editor · **Persona:** Studio manager · **Linked E2E:** `e2e/allocation.spec.ts` → "deletes an allocation from the edit dialog and ⌘Z restores it" · `e2e/features.spec.ts` → "undo restores a deleted allocation"

## Goal
Remove a single allocation from the schedule, and be able to undo that removal.

## Why
Bookings get cancelled. The manager needs a quick, single-click way to drop one allocation — and the safety of undo in case it was a mistake, since the deletion is immediate (no confirmation prompt for allocations).

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`. The seed has a *Brand System* bar (on **Nike Spiros**).
1. Click the **Brand System** bar. The **Edit allocation** dialog opens.
2. Click **Delete**. The dialog closes immediately and the bar disappears (there is no "Delete allocation?" confirmation — that confirm dialog exists only for list-page entity deletes).
3. Press **⌘Z** (Undo).

## Acceptance criteria
- ✅ After clicking **Delete**, the **Brand System** bar is gone from the schedule and the total `allocation-bar` count drops by one.
- ✅ No confirmation dialog appears for an allocation delete — it is immediate.
- ✅ Pressing **⌘Z** restores the exact same bar (same resource, activity, dates, hours and status).
- ✅ The delete is undoable via **⌘Z** OR the toolbar **Undo** button — either path restores the bar.
