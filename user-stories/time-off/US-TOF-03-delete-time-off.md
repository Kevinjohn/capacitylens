# US-TOF-03 — Delete a time-off entry (confirmed)

**Area:** Time off · **Persona:** Studio manager · **Linked E2E:** `e2e/timeoff.spec.ts` · **Docs:** [Time off](../../docs-src/using/time-off.md)

## Goal

Remove a time-off entry the resource no longer needs, with a confirmation step.

## Why

A booked holiday gets cancelled. The manager deletes the entry so the schedule frees those days back up — but deletes are easy to fumble, so there's a confirm step and Undo can restore it.

## How (end-to-end)

**Precondition:** Seeded app open; click **Time off** in the sidebar (`/timeoff`). The seed has **Bruce Wayne** off **10–12 June (Holiday)**.

1. On the **Bruce Wayne** row (reading _Wed 10th Jun · 3 days_), click the **Delete** (trash) icon. The "Delete time off?" confirmation dialog opens.
2. Read the dialog message: "Remove this time-off entry?".
3. Click **Cancel** — the dialog closes and the row is unchanged (proves Cancel is safe).
4. Click the **Delete** (trash) icon on the row again, then click **Delete** in the dialog to confirm. The dialog closes.
5. Go to **Schedule** (`/`), click **Today** so the seed bars are in view, **Weeks visible** = **1 week**, to confirm the block is gone.
6. Press **⌘Z**. The entry and its timeline block return; Redo removes them again.

## Acceptance criteria

- ✅ The confirmation dialog is titled **Delete time off?** with the message "Remove this time-off entry?" and **Delete** / **Cancel** buttons.
- ✅ **Cancel** closes the dialog and leaves the `timeoff-row` (and Bruce's timeline block) in place.
- ✅ After confirming **Delete**, Bruce's `timeoff-row` is removed from the list and his 10–12 June `timeoff-block` disappears from the Schedule (those days are no longer unavailable).
- ✅ Pressing **⌘Z** restores the same entry and timeline block. Redo deletes it again.
