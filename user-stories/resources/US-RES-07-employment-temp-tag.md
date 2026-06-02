# US-RES-07 — Employment type and the "Temp" tag

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "freelancers show a Temp tag; permanent staff do not"

## Goal
Mark a person's employment type (permanent, freelancer or contractor) so non-permanent
staff are visibly flagged with a "Temp" tag.

## Why
A manager scanning the schedule needs to tell employees from temporary staff at a glance —
freelancers and contractors are scheduled and budgeted differently. The "Temp" tag makes
that distinction obvious without opening each record.

## How (end-to-end)
**Precondition:** Seeded app open; click **Resources** in the sidebar.
1. On the **Tyler Nix** row (permanent), click **Edit**.
2. Change **Employment** = *Freelancer*. Click **Save**.
3. Observe Tyler's list row now carries a **"Temp"** tag.
4. Edit **Tyler Nix** again and set **Employment** = *Permanent*; Save. The tag disappears.

## Acceptance criteria
- ✅ Setting **Employment** = *Freelancer* or *Contractor* shows a **"Temp"** tag on that
  person's row in the Resources list and on their row in **Schedule**.
- ✅ Setting **Employment** = *Permanent* shows **no** Temp tag in either place.
- ✅ The seeded **Alex Rivera** (freelancer) already shows a Temp tag; the seeded permanent
  staff (Tyler, Pam, Nike) do not.
- ✅ For a **Placeholder** the **Employment** field is hidden in the dialog and no Temp tag
  ever shows (placeholders are always permanent).
