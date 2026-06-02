# US-DIS-01 — Add a discipline

**Area:** Disciplines · **Persona:** Studio manager · **Linked E2E:** `e2e/disciplines.spec.ts` → "adds a discipline and shows it in the list and as a schedule group"

## Goal
Add a new discipline (with a name and colour) so resources can be grouped under it on the schedule.

## Why
Disciplines are how the studio organises its people on the timeline (Design, Development, Copywriting…). Adding a discipline once gives the manager a named, coloured bucket that every resource and the schedule grouping key off — without it, new kinds of work have nowhere to live.

## How (end-to-end)
**Precondition:** Seeded app open; click **Disciplines** in the sidebar (`/disciplines`). The list shows *Design*, *Development*, *Copywriting*.
1. Click **Add discipline**. The "Add discipline" dialog opens.
2. Fill **Name** = `Strategy`.
3. Open **Colour** and pick a swatch from the preset grid.
4. Click **Save**. The dialog closes. (Sort order is assigned automatically — a new discipline lands after the existing ones.)
5. Click **Schedule** in the sidebar (`/`); if seed bars are needed for orientation use **Jump to date** → `2026-06-01`.

## Acceptance criteria
- ✅ After Save, the dialog closes and a row for **Strategy** appears in the Disciplines list.
- ✅ The Strategy row shows its colour swatch next to its name.
- ✅ On the **Schedule**, a **Strategy** group header appears (a `discipline-group`), positioned by its (auto-assigned) sort order.
- ✅ Saving with an empty **Name** keeps the dialog open and shows an inline required-field error associated with the Name field (`aria-invalid`).
- ✅ The **Colour** picker offers only preset swatches, so a saved colour is always a valid 6-digit `#rrggbb`.
