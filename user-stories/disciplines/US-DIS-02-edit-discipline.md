# US-DIS-02 — Edit a discipline

**Area:** Disciplines · **Persona:** Studio manager · **Linked E2E:** `e2e/disciplines.spec.ts` → "edits a discipline and reflects the change in the list and schedule group header"

## Goal
Change an existing discipline's name, colour and sort order, and see the change reflected in both the Disciplines list and the schedule grouping.

## Why
Studios rename and re-colour their categories as the business evolves (a "Development" team becomes "Engineering", a colour clashes with a client's brand). The edit must propagate everywhere the discipline is shown so the schedule stays readable and consistent.

## How (end-to-end)
**Precondition:** Seeded app open; click **Disciplines** in the sidebar (`/disciplines`). The *Development* discipline (order 1) exists.
1. On the **Development** row, click **Edit**. The dialog opens pre-filled with that discipline's values.
2. Change **Name** = `Engineering`.
3. Change the **Colour** by opening it and picking a different swatch.
4. Change **Sort order** = `5`.
5. Click **Save**. The dialog closes.
6. Click **Schedule** in the sidebar (`/`); use **Jump to date** → `2026-06-01` to see the seed bars.

## Acceptance criteria
- ✅ The Disciplines list row now reads **Engineering** with the new colour swatch and sort-order `5`.
- ✅ On the **Schedule**, the group that held *Nike Spiros* and *Alex Rivera* now shows the header **Engineering** in the new colour.
- ✅ Because the sort order changed, the **Engineering** group's position in the grouping order updates accordingly.
- ✅ The resources previously grouped under Development (Nike, Alex) are still under the renamed Engineering group — editing does not move or drop them.
- ✅ Clearing **Name** to empty and clicking **Save** is rejected (required-field error, dialog stays open).
