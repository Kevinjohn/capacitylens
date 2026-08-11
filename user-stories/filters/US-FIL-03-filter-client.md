# US-FIL-03 — Filter by client

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "filters bars to a client"

## Goal

Show only the allocations whose activity's project belongs to a chosen client, while capacity cues still reflect all of a person's work.

## Why

For a client review or billing check, the manager wants to see just that client's work on the schedule. But hiding other bars must not lie about how busy people are — over-allocation and utilisation must still account for the hidden work, so nobody looks free when they aren't.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`); set **Weeks visible** to **4 weeks**, click **Today**, then click **Show filters** so the seed bars and filter row are in view. Seed clients are _Queen Consolidated_ (Project Watchtower) and _LexCorp_ (Metropolis Rebrand).

1. Open the **Filter by client** select.
2. Choose **Queen Consolidated**.

## Acceptance criteria

- ✅ Choosing **Queen Consolidated** collapses the schedule to the allocations on _Project Watchtower_ activities (e.g. _Wireframes_, _Visual Design_, _CMS Review_) — resources with no Queen Consolidated work are **hidden by default**. Ticking **Show unallocated** (off by default) brings them back **visible but dimmed**, still showing their full real utilisation (so you can see who's free to staff).
- ✅ Capacity stays truthful: **over-markers** (`over-marker`) and the per-resource **utilisation %** (`utilization`) still reflect **all** of each resource's work, not just the filtered-in bars.
- ✅ Setting the select back to **All clients** restores every bar.
- ✅ While a client filter is active, the **Clear** button is shown.
