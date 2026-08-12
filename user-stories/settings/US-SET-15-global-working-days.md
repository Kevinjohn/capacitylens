# US-SET-15 — Global working days

**Area:** Settings and Schedule · **Persona:** Studio manager · **Linked E2E:** `e2e/global-working-days.spec.ts` → "sets global working days and gates schedule creation starts"

## Goal

Choose the weekdays on which the company accepts new work so the schedule does not advertise or
start allocations on dates the agency, person or time-off record makes unavailable.

## Why

Personal working patterns describe an individual's week, but the whole company may use a shorter or
differently arranged week. The schedule should enforce both boundaries at the gesture itself rather
than displaying a misleading add hint and opening a form that cannot represent an available start.

## How (end-to-end)

1. Open **Settings** and find **Global working days**.
2. Confirm one row of seven abbreviated weekday headings appears above one row of seven checkboxes,
   following the company's configured week start, with the first five selected for a new company.
3. Clear **Friday**, then return to **Schedule**.
4. Hover and click Bruce Wayne's Friday lane cell. Confirm there is no hover **+** and no allocation
   form opens.
5. Confirm the same behavior on one of Bruce's personal non-working days and on a date covered by his
   holiday.
6. Start a multi-day draw on an allowed date and cross a blocked date. Confirm the allocation form
   opens with the full drawn span.

## Acceptance criteria

- ✅ Editors and above can change all seven account weekdays; Viewers see disabled checkboxes.
- ✅ The weekdays remain exactly two table rows: abbreviated headings above their associated controls.
- ✅ The saved set is independent of presentation order: changing week start only reorders it.
- ✅ A lane start on a global non-working, personal non-working or time-off date has no hover add hint
  and does not open a form from click or draw.
- ✅ A multi-day span may cross blocked dates after an allowed start.
- ✅ The allocation's **Ignore working days** choice never bypasses the start boundary.
- ✅ Existing capacity and utilisation calculations are unchanged.
