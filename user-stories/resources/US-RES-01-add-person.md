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
3. Choose **Discipline** = _Design_.
4. Leave **Employment** = _Permanent_.
5. In **Working days**, ensure Mon–Fri are **Full day** and Sat/Sun are **Not working**.
6. Click **Save**. The dialog closes.

## Acceptance criteria

- ✅ After Save, the dialog closes and a row for **Dana Lee** appears in the Resources list.
- ✅ The row shows the role (_Motion Designer_) and a colour avatar with the initials _DL_.
- ✅ Going to **Schedule** shows a _Dana Lee_ row under the **Design** group.
- ✅ Saving with an empty **Name** keeps the dialog open and shows an inline error
  ("Name is required for a person.") associated with the Name field (`aria-invalid`).
- ✅ The saved resource uses the fixed **8-hour** full-day capacity.
