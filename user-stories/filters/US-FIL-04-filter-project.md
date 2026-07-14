# US-FIL-04 — Filter by project

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "filters the schedule to a single project" · `e2e/features.spec.ts` → "filtering by project narrows the schedule to that project"

## Goal
Show only the allocations belonging to a chosen project.

## Why
When focused on one project's delivery, the manager wants the schedule reduced to just that project's bookings — the tightest, most common slice.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`. More than one project's bars are visible.
1. Open the **Filter by project** select.
2. Choose **Brand Themes** (`p-brand`).

## Acceptance criteria
- ✅ Choosing **Brand Themes** collapses the view to exactly that project's work — the *Brand System* bar; allocations from other projects (e.g. *Project Lightning* activities) are hidden, along with the resources that have no Brand Themes work.
- ✅ Ticking **Show unallocated** (off by default) brings the non-matching resources back **visible but dimmed**, still showing their full real load.
- ✅ Setting the select back to **All projects** restores every bar.
- ✅ While a project filter is active, the **Clear** button is shown.
