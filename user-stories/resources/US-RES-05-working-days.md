# US-RES-05 — Set a resource's working days

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "non-working weekdays are greyed and carry no capacity"

## Goal
Set which weekdays a resource works (the Mon–Sun toggles), so the schedule only treats
their working days as available.

## Why
Not everyone works five days. A freelancer might be Mon–Wed only. The manager sets that
pattern once and the timeline greys out their off-days and refuses to count capacity on
them, so nobody plans work into a day the person never works.

## How (end-to-end)
**Precondition:** Seeded app open; click **Resources** in the sidebar. The seed already has
**Alex Rivera** (freelancer) set to **Mon–Wed only**.
1. On the **Alex Rivera** row, click **Edit**. The "Edit resource" dialog opens.
2. In **Working days**, confirm Mon, Tue, Wed are pressed (`aria-pressed="true"`) and
   Thu, Fri, Sat, Sun are off.
3. Click **Save** (no change needed — this is the verified state).
4. Go to **Schedule** and set the zoom to **1w** (or **2w**) so individual day columns are
   wide enough to render the per-day tint.

## Acceptance criteria
- ✅ In the dialog, the **Working days** toggles reflect the resource's pattern via
  `aria-pressed` (Mon–Wed on; Thu/Fri/Sat/Sun off).
- ✅ On the timeline at fine zoom, Alex's **Thu** and **Fri** columns are greyed as
  unavailable days (`data-testid="unavailable-day"`).
- ✅ A non-working day carries **0** capacity: any work landing on Alex's Thu/Fri reads as
  over-allocated (a red `over-marker` on that day / a red `utilization` value), because
  available hours there are 0.
- ✅ Toggling, e.g., **Thu** on and saving makes that column available (no longer greyed).
