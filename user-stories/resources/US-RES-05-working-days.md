# US-RES-05 — Set a resource's working days

**Area:** Resources · **Persona:** Studio manager · **Coverage:** **Unit:** `src/lib/capacity.test.ts` (non-working days carry 0 capacity) + `src/components/resources/ResourceForm.test.tsx`. The greyed unavailable-day rendering is verified manually.

## Goal

Set which weekdays a resource works (the Mon–Sun toggles), so the schedule only treats
their working days as available.

## Why

Not everyone works five days. A freelancer might be Mon–Wed only. The manager sets that
pattern once and the timeline greys out their off-days and refuses to count capacity on
them, so nobody plans work into a day the person never works.

## How (end-to-end)

**Precondition:** Seeded app open; click **Resources** in the sidebar. The seed already has
**Barry Allen** (freelancer) set to **Mon–Wed only**.

1. On the **Barry Allen** row, click the **Edit** (pencil) icon. The "Edit resource" dialog opens.
2. In **Working days**, confirm Mon, Tue, Wed are pressed (`aria-pressed="true"`) and
   Thu, Fri, Sat, Sun are off.
3. Click **Save** (no change needed — this is the verified state).
4. Go to **Schedule** and set **Weeks visible** to **1 week** (or **2 weeks**) so individual day columns are
   wide enough to render the per-day tint.

## Acceptance criteria

- ✅ In the dialog, the **Working days** toggles reflect the resource's pattern via
  `aria-pressed` (Mon–Wed on; Thu/Fri/Sat/Sun off).
- ✅ On the timeline at fine zoom, Barry's **Thu** and **Fri** columns are greyed as
  unavailable days (`data-testid="unavailable-day"`).
- ✅ A non-working day carries **0** capacity. A normal allocation that merely spans Barry's
  Thu/Fri contributes **0 allocated hours** there, so those days stay grey but are not red.
  An allocation that explicitly enables **Include weekends as working days** does place its hours
  on those zero-capacity days, which then show a red `over-marker` / `utilization` value.
- ✅ Toggling, e.g., **Thu** on and saving makes that column available (no longer greyed).
