# US-RES-06 — Set a resource's working hours per day

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "rejects zero working hours"

## Goal
Set how many hours a day a resource works, which becomes that resource's daily capacity.

## Why
A part-timer on 6h/day has less headroom than a full-timer on 8h/day. Capacity and
over-allocation both key off this number, so it has to be set correctly — and it can never
be zero or blank.

## How (end-to-end)
**Precondition:** Seeded app open; click **Resources** in the sidebar.
1. On the **Tyler Nix** row, click the **Edit** (pencil) icon. The "Edit resource" dialog opens (8h).
2. Change **Working hours / day** = `6`.
3. Click **Save**. The dialog closes.

## Acceptance criteria
- ✅ After Save, the **Tyler Nix** list row shows *6h/day*.
- ✅ On **Schedule** the resource's available hours per working day are now 6, so a working
  day allocated more than 6h reads as over-allocated (red `over-marker` / red `utilization`).
- ✅ Saving with **Working hours / day** = `0` keeps the dialog open and is rejected with
  the inline error ("must be greater than 0").
- ✅ Saving with an empty **Working hours / day** is likewise rejected (the value is not
  greater than 0).
