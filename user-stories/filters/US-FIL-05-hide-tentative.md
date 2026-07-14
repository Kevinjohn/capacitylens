# US-FIL-05 — Hide tentative allocations

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "hides tentative bars while capacity still counts them"

## Goal
Hide tentative allocations with the **Hide tentative** toggle, while capacity cues still count them.

## Why
When presenting a confirmed plan, the manager wants to drop the speculative bookings from view. But tentative work still consumes capacity, so the over-allocation and utilisation cues must keep counting it — hiding is a view filter, not a capacity change.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`. At least one allocation has **Status** = *Tentative* (set one via US-ALL-02 if needed; tentative bars render with a dashed/hatched style).
1. Tick the **Hide tentative** checkbox.

## Acceptance criteria
- ✅ Ticking **Hide tentative** removes every `data-status="tentative"` bar from view; confirmed and completed bars remain.
- ✅ Capacity stays truthful: **over-markers** (`over-marker`) and per-resource **utilisation %** (`utilization`) still account for the hidden tentative work.
- ✅ Un-ticking the checkbox brings the tentative bars back.
- ✅ While **Hide tentative** is on, the **Clear** button is shown.
