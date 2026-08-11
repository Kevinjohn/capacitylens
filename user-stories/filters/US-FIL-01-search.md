# US-FIL-01 — Search resources by name or role

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "searches resources by name and hides non-matching rows"

## Goal

Narrow the schedule to the people who match a typed search of their name or role.

## Why

A large studio's schedule is long. Typing part of a name or role is the quickest way to focus on the person (or kind of person) the manager is thinking about, without scrolling.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`); set **Weeks visible** to **4 weeks** and
click **Today**, then click **Show filters**, so the seeded people and filter row are visible. Placeholders and external resources remain hidden by
their default-off account settings and are outside this search example.

1. Click the **Search people…** box.
2. Type `Bruce`.
3. Clear the box and type `Developer`.

## Acceptance criteria

- ✅ Typing `Bruce` narrows the visible resource rows to **Bruce Wayne** only; non-matching rows (Diana, Clark, Barry, the placeholder) are hidden.
- ✅ Search matches on **role** too: typing `Developer` shows the resources whose role contains it (e.g. _Clark Kent — Web Developer_, _Barry Allen — Front End_).
- ✅ Clearing the search box restores all resource rows.
- ✅ While a search is active, the **Clear Filters** button is enabled.
