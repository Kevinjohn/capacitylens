# US-DIS-01 — Add a discipline

**Area:** Disciplines · **Persona:** Studio manager · **Linked E2E:** `e2e/disciplines.spec.ts` → "adds a discipline and shows it in the list and as a schedule group"

## Goal
Add a new discipline (with a name, sort order and colour) so resources can be grouped under it on the schedule.

## Why
Disciplines are how the studio organises its people on the timeline (Design, Development, Copywriting…). Adding a discipline once gives the manager a named, coloured bucket that every resource and the schedule grouping key off — without it, new kinds of work have nowhere to live.

## How (end-to-end)
**Precondition:** Seeded app open; click **Disciplines** in the sidebar (`/disciplines`). The list shows *Design*, *Development*, *Copywriting*.
1. Click **Add discipline**. The "Add discipline" dialog opens.
2. Fill **Name** = `Strategy`.
3. Set **Sort order** = `3` (so it sorts after the seeded three).
4. Pick a **Colour** (or type a valid hex like `#22c55e` in **Colour hex value**).
5. Click **Save**. The dialog closes.
6. Click **Schedule** in the sidebar (`/`); if seed bars are needed for orientation use **Jump to date** → `2026-06-01`.

## Acceptance criteria
- ✅ After Save, the dialog closes and a row for **Strategy** appears in the Disciplines list.
- ✅ The Strategy row shows its colour swatch and its sort-order value.
- ✅ On the **Schedule**, a **Strategy** group header appears (a `discipline-group`), positioned by its sort order.
- ✅ Saving with an empty **Name** keeps the dialog open and shows an inline required-field error associated with the Name field (`aria-invalid`).
- ✅ Saving with an invalid colour (e.g. `nope` in the **Colour hex value** box, not a 6-digit `#rrggbb`) is rejected and the dialog stays open.
