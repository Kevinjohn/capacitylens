# US-FIL-04 — Filter by project

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "filters the schedule to a single project" · `e2e/features.spec.ts` → "filtering by project narrows the schedule to that project"

## Goal

Show only the allocations belonging to a chosen project.

## Why

When focused on one project's delivery, the manager wants the schedule reduced to just that project's bookings — the tightest, most common slice.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`); set **Weeks visible** to **4 weeks**, click **Today**, then click **Show filters** so more than one project's bars and the filter row are visible.

1. Open the **Filter by project** select.
2. Choose **Metropolis Rebrand** (`p-brand`).

## Acceptance criteria

- ✅ Internal-owned projects come first; each section is alphabetical by project name.
- ✅ Choosing **Metropolis Rebrand** collapses the view to exactly that project's work — the _Brand System_ bar; allocations from other projects (e.g. _Project Watchtower_ activities) are hidden, along with the resources that have no Metropolis Rebrand work.
- ✅ Ticking **Show unallocated** (off by default) brings the non-matching resources back **visible but dimmed**, still showing their full real utilisation.
- ✅ Setting the select back to **All projects** restores every bar.
- ✅ While a project filter is active, the **Clear Filters** button is enabled.
- ✅ The project picker keeps **All projects** first, then sorts by client and project using each
  item's trimmed code name when available, otherwise its ordinary name. Comparison is
  case-insensitive and deterministic.
- ✅ Each project option keeps its complete `Client / Project` accessible label while visually
  muting the client and slash so the project name remains prominent in every interaction state.
