# US-RES-05 — Set a resource's working days

**Area:** Resources · **Persona:** Studio manager · **Coverage:** **Unit:** `src/lib/capacity.test.ts` (full, half and non-working capacity) + `src/components/resources/ResourceForm.test.tsx` · **E2E:** `e2e/resources.spec.ts` (persist a mixed working-week pattern).

## Goal

Set whether each Monday–Sunday weekday is a full day, half day or non-working day, so the
schedule uses the resource's real availability.

## Why

Not everyone works five full days. A freelancer might be full-time Monday–Tuesday, work a
four-hour half day on Wednesday and not work the rest of the week. The manager sets that pattern
once, and the timeline uses the resulting capacity while still greying out off-days.

## How (end-to-end)

**Precondition:** Seeded app open; click **Resources** in the sidebar. The seed already has
**Barry Allen** (freelancer) set to **Mon–Wed only**.

1. On the **Barry Allen** row, click the **Edit** (pencil) icon. The "Edit resource" dialog opens.
2. In **Working days**, confirm Monday, Tuesday and Wednesday have **Full day** selected, while
   Thursday, Friday, Saturday and Sunday have **Not working** selected.
3. Click **Save** (no change needed — this is the verified state).
4. Go to **Schedule** and set **Weeks visible** to **1 week** (or **2 weeks**) so individual day columns are
   wide enough to render the per-day tint.

## Acceptance criteria

- ✅ The dialog presents one labelled row for every day from Monday through Sunday. Each row has
  exactly one selected choice: **Full day**, **Half day** or **Not working**.
- ✅ Existing selected weekdays open as **Full day** and existing unselected weekdays open as
  **Not working**; changing the UI does not turn an existing full day into a half day.
- ✅ A **Full day** contributes the resource's configured **Working hours / day**, a **Half day**
  contributes exactly **4 hours**, and **Not working** contributes **0 hours**.
- ✅ On the timeline at fine zoom, Barry's **Thu** and **Fri** columns are greyed as
  unavailable days (`data-testid="unavailable-day"`).
- ✅ A non-working day carries **0** capacity. A normal allocation that merely spans Barry's
  Thu/Fri contributes **0 allocated hours** there, so those days stay grey but are not red.
  An allocation that explicitly enables **Include weekends as working days** does place its hours
  on those zero-capacity days, which then show a red `over-marker` / `utilization` value.
- ✅ Selecting **Half day** for Thursday and saving makes that column available with 4 hours of
  capacity; an allocation above 4 hours is over capacity, while exactly 4 hours is not.
- ✅ At least one weekday must be **Full day** or **Half day**.
