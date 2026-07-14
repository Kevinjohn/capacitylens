# US-FIL-01 — Search resources by name or role

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "searches resources by name and hides non-matching rows"

## Goal
Narrow the schedule to the people who match a typed search of their name or role.

## Why
A large studio's schedule is long. Typing part of a name or role is the quickest way to focus on the person (or kind of person) the manager is thinking about, without scrolling.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`. All seed resources are visible.
1. Click the **Search people…** box.
2. Type `Tyler`.
3. Clear the box and type `Developer`.

## Acceptance criteria
- ✅ Typing `Tyler` narrows the visible resource rows to **Tyler Nix** only; non-matching rows (Pam, Nike, Alex, the placeholder) are hidden.
- ✅ Search matches on **role** too: typing `Developer` shows the resources whose role contains it (e.g. *Nike Spiros — Web Developer*, *Alex Rivera — Front End*).
- ✅ Clearing the search box restores all resource rows.
- ✅ While a search is active, the **Clear** button is shown.
