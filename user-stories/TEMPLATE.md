# User-story template & exemplar

Every story file follows this shape. Goal first, then why, then how, then explicit,
checkable acceptance criteria. Steps are end-to-end and runnable by a human from the
stated precondition with no other setup.

```
# US-XXX-NN — <short title>

**Area:** <area> · **Persona:** <who> · **Linked E2E:** `e2e/<file>.spec.ts` → "<test title>"

## Goal
<one sentence — the outcome the user wants>

## Why
<the value/motivation — why this matters to the user and the business>

## How (end-to-end)
**Precondition:** <starting state, e.g. "Seeded app open at Schedule (`/`)">
1. <action>
2. <action>
3. <observed result>

## Acceptance criteria
- ✅ <a concrete, checkable assertion>
- ✅ <another>
- ✅ <edge/negative case where relevant>
```

---

## Exemplar (the standard to match)

# US-RES-01 — Add a person resource

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "adds a person and shows them in the list"

## Goal
Add a named person (with a role, discipline, working pattern and colour) so they can be scheduled.

## Why
The schedule is only useful once the team is in it. A studio manager onboards each new
hire or freelancer once; everything downstream (allocations, capacity, utilisation) keys
off that resource record.

## How (end-to-end)
**Precondition:** Seeded app open; click **Resources** in the sidebar.
1. Click **Add resource**. The "Add resource" dialog opens.
2. Leave **Type** as *Person*.
3. Fill **Name** = `Dana Lee`, **Role** = `Motion Designer`.
4. Choose **Discipline** = *Design*.
5. Leave **Employment** = *Permanent*; set **Working hours / day** = `8`.
6. In **Working days**, ensure Mon–Fri are selected (toggle Sat/Sun off if on).
7. Pick a **Colour** (or type a valid hex like `#22c55e`).
8. Click **Save**. The dialog closes.

## Acceptance criteria
- ✅ After Save, the dialog closes and a row for **Dana Lee** appears in the Resources list.
- ✅ The row shows the role (*Motion Designer*) and a colour avatar with the initials *DL*.
- ✅ Going to **Schedule** shows a *Dana Lee* row under the **Design** group.
- ✅ Saving with an empty **Name** keeps the dialog open and shows an inline error
  ("Name is required for a person.") associated with the Name field (`aria-invalid`).
- ✅ Saving with **Working hours / day** = `0` is rejected ("must be greater than 0").
- ✅ Saving with an invalid colour (e.g. `nope` in the hex box) is rejected.
