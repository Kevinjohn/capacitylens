# US-RES-07 — Employment type (Temp tag parked)

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "the Temp tag is parked: freelancers render untagged"

## Goal
Record a person's employment type (permanent, freelancer or contractor) on their resource
record. **No visual tag is rendered for now** — the old "Temp" pill is parked.

## Why
Freelancers and contractors are scheduled and budgeted differently, so the data must be
captured. But the owner has parked the visual treatment: the real differentiation
(freelancers vs contractors vs external suppliers, plus a third-party FYI line on the
schedule) will be designed together later — see `NEEDS-INPUT.md` → "Parked". Until then the
pill is hidden rather than half-designed.

## How (end-to-end)
**Precondition:** Seeded app open; click **Resources** in the sidebar.
1. On the **Tyler Nix** row (permanent), click **Edit**.
2. Observe the **Employment** select (Permanent / Freelancer / Contractor) — change it to
   *Freelancer* and Save.
3. Observe Tyler's list row: it looks unchanged — **no tag appears**.
4. Edit **Tyler Nix** again: the select still shows *Freelancer* (the value persisted).
   Set it back to *Permanent*; Save.

## Acceptance criteria
- ✅ The **Employment** select exists on the person form and its value round-trips
  through Save/Edit.
- ✅ **No "Temp" tag renders anywhere** — not in the Resources list, not on the schedule —
  regardless of employment type. The seeded freelancer **Alex Rivera** shows no tag.
- ✅ For a **Placeholder** the **Employment** field is hidden in the dialog (placeholders
  are always permanent).
