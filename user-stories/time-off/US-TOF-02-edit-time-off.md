# US-TOF-02 — Edit a time-off entry

**Area:** Time off · **Persona:** Studio manager · **Linked E2E:** `e2e/timeoff.spec.ts` → "edits a time-off entry and reflects the change in the list and on the timeline"

## Goal
Change an existing time-off entry's type and/or dates, and have the list row and the timeline block update to match.

## Why
Plans move. A holiday gets shortened, or what was logged as a holiday turns out to be sick leave. The manager fixes the existing entry in place rather than deleting and re-booking, and the schedule's unavailable days shift with it automatically.

## How (end-to-end)
**Precondition:** Seeded app open; click **Time off** in the sidebar (`/timeoff`). The seed already has **Tyler Nix** off **10–12 June (Holiday)**.
1. On the **Tyler Nix · 2026-06-10 → 2026-06-12 · Holiday** row, click **Edit**. The "Edit time off" dialog opens.
2. Confirm the dialog is pre-filled: **Resource** = *Tyler Nix*, **Start** = `2026-06-10`, **End** = `2026-06-12`, **Type** = *Holiday*.
3. Change **Type** = *Sick* and shorten the range to **End** = `2026-06-11`.
4. Click **Save**. The dialog closes.
5. Go to **Schedule** (`/`), use **Jump to date** → `2026-06-01`, and set the zoom to **1w** to read the block over Tyler's lane.

## Acceptance criteria
- ✅ The dialog is titled **Edit time off** and pre-fills every field from the existing entry (resource, start, end, type, note).
- ✅ After Save, Tyler's `timeoff-row` updates to `Tyler Nix · 2026-06-10 → 2026-06-11 · Sick`.
- ✅ On the Schedule (Jump to date → 2026-06-01, zoom **1w**), Tyler's `timeoff-block` now spans 10–11 June (one day shorter) and carries the new type label; 12 June is no longer covered.
- ✅ Editing back (or pressing **⌘Z**) returns the entry to its prior state — the edit is reversible.
- ✅ The same validation as creating applies: a reversed range (End before Start) keeps the dialog open with "End date cannot be before the start date."
