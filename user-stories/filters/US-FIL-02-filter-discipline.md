# US-FIL-02 — Filter by discipline

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "filters the schedule by discipline"

## Goal

Show only the resources belonging to a chosen discipline.

## Why

Managers often plan one discipline at a time — "how booked is Design this fortnight?". Filtering to a discipline removes the noise of every other group.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`); set **Weeks visible** to **4 weeks**, click **Today**, then click **Show filters** so the seed bars and filter row are in view. Seed disciplines are Design, Development, Copywriting.

1. Open the **Filter by discipline** select.
2. Choose **Development**.

## Acceptance criteria

- ✅ The options follow the schedule grid's canonical discipline order (Design, Development,
  Copywriting in the seed), rather than sorting by name.
- ✅ Choosing **Development** shows only that group's resources (_Clark Kent_, _Barry Allen_); Design and Copywriting rows/groups are hidden.
- ✅ The **Design** and **Copywriting** discipline group headers are no longer shown.
- ✅ Setting the select back to **All disciplines** restores every group.
- ✅ While a discipline filter is active, the **Clear Filters** button is enabled.
