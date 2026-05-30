# US-FIL-02 — Filter by discipline

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "filters the schedule by discipline"

## Goal
Show only the resources belonging to a chosen discipline.

## Why
Managers often plan one discipline at a time — "how booked is Design this fortnight?". Filtering to a discipline removes the noise of every other group.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`. Seed disciplines are Design, Development, Copywriting.
1. Open the **Filter by discipline** select.
2. Choose **Development**.

## Acceptance criteria
- ✅ Choosing **Development** shows only that group's resources (*Nike Spiros*, *Alex Rivera*); Design and Copywriting rows/groups are hidden.
- ✅ The **Design** and **Copywriting** discipline group headers are no longer shown.
- ✅ Setting the select back to **All disciplines** restores every group.
- ✅ While a discipline filter is active, the **Clear** button is shown.
