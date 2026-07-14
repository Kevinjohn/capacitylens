# US-TOF-03 — Delete a time-off entry (undoable)

**Area:** Time off · **Persona:** Studio manager · **Linked E2E:** `e2e/timeoff.spec.ts` → "deletes a time-off entry after confirmation and restores it with undo"

## Goal
Remove a time-off entry the resource no longer needs, with a confirmation step, and be able to undo it if removed by mistake.

## Why
A booked holiday gets cancelled. The manager deletes the entry so the schedule frees those days back up — but deletes are easy to fumble, so there's a confirm step and ⌘Z brings it straight back.

## How (end-to-end)
**Precondition:** Seeded app open; click **Time off** in the sidebar (`/timeoff`). The seed has **Tyler Nix** off **10–12 June (Holiday)**.
1. On the **Tyler Nix** row (reading *Wed 10th Jun · 3 days*), click the **Delete** (trash) icon. The "Delete time off?" confirmation dialog opens.
2. Read the dialog message: "Remove this time-off entry?".
3. Click **Cancel** — the dialog closes and the row is unchanged (proves Cancel is safe).
4. Click the **Delete** (trash) icon on the row again, then click **Delete** in the dialog to confirm. The dialog closes.
5. Go to **Schedule** (`/`), **Jump to date** → `2026-06-01`, zoom **1w**, to confirm the block is gone.
6. Press **⌘Z** (Undo) to restore the entry.

## Acceptance criteria
- ✅ The confirmation dialog is titled **Delete time off?** with the message "Remove this time-off entry?" and **Delete** / **Cancel** buttons.
- ✅ **Cancel** closes the dialog and leaves the `timeoff-row` (and Tyler's timeline block) in place.
- ✅ After confirming **Delete**, Tyler's `timeoff-row` is removed from the list and his 10–12 June `timeoff-block` disappears from the Schedule (those days are no longer unavailable).
- ✅ Pressing **⌘Z** restores the deleted entry — the row reappears and the timeline block returns over 10–12 June.
