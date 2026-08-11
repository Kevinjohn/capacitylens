# US-FIL-06 — Clear all filters at once

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "clears all active filters with the Clear Filters button"

## Goal

Reset the search, all the filter selects and the Hide-tentative toggle in one click with **Clear Filters**.

## Why

After narrowing the view several ways, getting back to the full schedule one control at a time is tedious. A single **Clear Filters** restores everything at once.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`); set **Weeks visible** to **4 weeks**, click **Today**, then click **Show filters** so the seed bars and filter row are in view.

1. Type `Clark` in **Search people…**.
2. Choose a **Filter by discipline** (e.g. _Development_).
3. Choose a **Filter by client** and a **Filter by project**.
4. Tick **Hide tentative**.
5. Click **Clear Filters**.

## Acceptance criteria

- ✅ **Clear Filters** remains at the far right whenever the filter toolbar is open.
- ✅ With no active filter it is visually quiet, has no bin icon and is disabled.
- ✅ With any active filter it uses the red soft-danger style, shows a decorative bin icon and is enabled.
- ✅ Clicking **Clear Filters** empties the **Search people…** box, returns every filter select to its "All …" option, and unticks **Hide tentative** and **Show unallocated**.
- ✅ After clearing, the full schedule returns — all resource rows, all groups and all bars are visible again.
