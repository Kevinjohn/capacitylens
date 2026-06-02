# US-FIL-03 — Filter by client

**Area:** Filters · **Persona:** Studio manager · **Linked E2E:** `e2e/filters.spec.ts` → "filters bars to a client"

## Goal
Show only the allocations whose task's project belongs to a chosen client, while capacity cues still reflect all of a person's work.

## Why
For a client review or billing check, the manager wants to see just that client's work on the schedule. But hiding other bars must not lie about how busy people are — over-allocation and utilisation must still account for the hidden work, so nobody looks free when they aren't.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`. Seed clients are *Acme Inc.* (Project Lightning) and *Globex* (Brand Themes).
1. Open the **Filter by client** select.
2. Choose **Acme Inc.**.

## Acceptance criteria
- ✅ Choosing **Acme Inc.** highlights the allocations on *Project Lightning* tasks (e.g. *Wireframes*, *Visual Design*, *CMS Review*). Resources with no Acme work stay **visible but dimmed**, still showing their full real load (so you can see who's free to staff); un-ticking **Show unallocated** (on by default) collapses the view to just the matching Acme bars.
- ✅ Capacity stays truthful: **over-markers** (`over-marker`) and the per-resource **utilisation %** (`utilization`) still reflect **all** of each resource's work, not just the filtered-in bars.
- ✅ Setting the select back to **All clients** restores every bar.
- ✅ While a client filter is active, the **Clear** button is shown.
