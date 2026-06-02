# US-DIS-04 — Disciplines display in a stable order (ties broken by name)

**Area:** Disciplines · **Persona:** Studio manager · **Linked E2E:** `e2e/disciplines.spec.ts` → "adds a discipline and shows it in the list and as a schedule group" · **Unit:** `src/store/selectors.extra.test.ts` → "orders by sortOrder, then name as a stable tiebreak on equal sortOrder"

## Goal
Have disciplines appear in one predictable order — identical in the Disciplines list and in the schedule grouping — with newly added disciplines landing after the existing ones, and any equal ordering broken alphabetically by name.

## Why
The manager wants the schedule to read top-to-bottom in a stable order, the same as the list, so a group never jumps around unexpectedly. Order is assigned **automatically** (a new discipline lands last) rather than hand-managed via a fiddly field; one shared sort rule (`byDisciplineOrder`) keeps the list and the schedule from ever disagreeing.

## How (end-to-end)
**Precondition:** Seeded app open; click **Disciplines** in the sidebar (`/disciplines`). Seed order is *Design*, *Development*, *Copywriting*.
1. Click **Add discipline**, name it `Strategy`, pick a colour, and **Save**.
2. Note where **Strategy** lands in the Disciplines list.
3. Click **Schedule** in the sidebar (`/`); use **Jump to date** → `2026-06-01`. Note the group order.

## Acceptance criteria
- ✅ A discipline's sort order is **assigned automatically** — there is no Sort-order field in the discipline form.
- ✅ The new **Strategy** discipline lands **after** the existing disciplines in the Disciplines list (it takes the next, highest sort order).
- ✅ The **schedule grouping order is identical** to the Disciplines list order — the two surfaces never disagree.
- ✅ The underlying rule — ascending sort order, with **equal** orders broken alphabetically by **name** — is covered by the unit test above. (Equal orders only arise from imported/seed data; they aren't reproducible from the UI, where each new order is unique.)
