# US-RES-01 — Add a person resource

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "adds a person and shows them in the list and schedule"

## Goal
Add a named person (with a role, discipline and working pattern) so they can be scheduled.

## Why
The schedule is only useful once the team is in it. A studio manager onboards each new
hire or freelancer once; everything downstream (allocations, capacity, utilisation) keys
off that resource record.

## How (end-to-end)
**Precondition:** Seeded app open; click **Resources** in the sidebar.
1. Click **Add resource**. The "Add resource" dialog opens (locked to a person — there is no Type switcher; placeholders have their own **Add placeholder** button).
2. Fill **Name** = `Dana Lee`, **Role** = `Motion Designer`.
3. Choose **Discipline** = *Design*.
4. Leave **Employment** = *Permanent*; set **Working hours / day** = `8`.
5. In **Working days**, ensure Mon–Fri are selected (toggle Sat/Sun off if on).
6. Click **Save**. The dialog closes.

## Acceptance criteria
- ✅ After Save, the dialog closes and a row for **Dana Lee** appears in the Resources list.
- ✅ The row shows the role (*Motion Designer*) and a colour avatar with the initials *DL*.
- ✅ Going to **Schedule** shows a *Dana Lee* row under the **Design** group.
- ✅ Saving with an empty **Name** keeps the dialog open and shows an inline error
  ("Name is required for a person.") associated with the Name field (`aria-invalid`).
- ✅ Saving with **Working hours / day** = `0` is rejected ("must be greater than 0").
