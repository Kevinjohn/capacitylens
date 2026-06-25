# US-FIL-07 — Empty state when no resource matches

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "shows the filtered empty state when nothing matches"

## Goal
When the active filters match no resource, show an empty state that explains why, instead of a blank grid.

## Why
A filter that hides everything looks broken. A clear message tells the manager the schedule isn't empty — their filter just matched nobody — so they fix the filter rather than worry about lost data.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`.
1. In **Search people…**, type a string that matches no resource name or role, e.g. `zzzzz`.
2. In the centred empty-state card, click **Clear filters**.

## Acceptance criteria
- ✅ With no resource matching, the grid shows the `scheduler-empty` element — a centred card (filter icon + the message **"No resources match the current filters."** + a short subtext) in the schedule body, matching the entity-list empty states.
- ✅ No discipline groups, resource rows or allocation bars are shown while the empty state is active.
- ✅ This is the *filtered* empty state — distinct from the no-data state shown when there are genuinely no resources yet (which instead offers a **Go to Resources** button).
- ✅ The empty state offers a **Clear filters** button; clicking it clears the active filters and the full schedule returns. (Clearing the search, or the toolbar **Clear**, does the same.)
