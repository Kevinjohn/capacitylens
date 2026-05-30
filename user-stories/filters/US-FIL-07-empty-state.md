# US-FIL-07 — Empty state when no resource matches

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "shows the filtered empty state when nothing matches"

## Goal
When the active filters match no resource, show an empty state that explains why, instead of a blank grid.

## Why
A filter that hides everything looks broken. A clear message tells the manager the schedule isn't empty — their filter just matched nobody — so they fix the filter rather than worry about lost data.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`.
1. In **Search people…**, type a string that matches no resource name or role, e.g. `zzzzz`.

## Acceptance criteria
- ✅ With no resource matching, the grid shows the `scheduler-empty` element with the message **"No resources match the current filters."**
- ✅ No discipline groups, resource rows or allocation bars are shown while the empty state is active.
- ✅ This is the *filtered* empty state — distinct from the no-data message shown when there are genuinely no resources yet.
- ✅ Clearing the search (or clicking **Clear**) removes the empty state and the full schedule returns.
