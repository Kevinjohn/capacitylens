# US-FIL-06 — Clear all filters at once

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "clears all active filters with the Clear button"

## Goal
Reset the search, all the filter selects and the Hide-tentative toggle in one click with **Clear**.

## Why
After narrowing the view several ways, getting back to the full schedule one control at a time is tedious. A single **Clear** — shown only when something is filtering — restores everything at once.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`.
1. Type `Nike` in **Search people…**.
2. Choose a **Filter by discipline** (e.g. *Development*).
3. Choose a **Filter by client** and a **Filter by project**.
4. Tick **Hide tentative**.
5. Click **Clear**.

## Acceptance criteria
- ✅ The **Clear** button is only present while at least one filter is active (search, any select, or Hide tentative).
- ✅ Clicking **Clear** empties the **Search people…** box, returns every filter select to its "All …" option, and unticks **Hide tentative**.
- ✅ After Clear, the full schedule returns — all resource rows, all groups and all bars are visible again.
- ✅ Once everything is reset, the **Clear** button is no longer shown.
