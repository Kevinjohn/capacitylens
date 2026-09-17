# US-FIL-05 — Hide tentative allocations

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "hides tentative bars while capacity still counts them"

## Goal

Hide tentative allocations by turning the **Tentative** pill off, while capacity cues still count them.

## Why

When presenting a confirmed plan, the manager wants to drop the speculative bookings from view. But tentative work still consumes capacity, so the over-allocation and utilisation cues must keep counting it — hiding is a view filter, not a capacity change.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`); set **Weeks visible** to **4 weeks**, click **Today**, then click **Show filters** so the seed bars and filter row are in view. At least one allocation has **Status** = _Tentative_ (set one via US-ALL-02 if needed; tentative bars render with a dashed/hatched style).

1. Turn the **Tentative** pill off.

## Acceptance criteria

- ✅ Turning **Tentative** off removes every `data-status="tentative"` bar from view; confirmed and completed bars remain.
- ✅ Capacity stays truthful: **over-markers** (`over-marker`) and per-resource **utilisation %** (`utilization`) still account for the hidden tentative work.
- ✅ Turning the pill back on brings the tentative bars back.
- ✅ While **Tentative** is off, the **Clear Filters** button is enabled.
