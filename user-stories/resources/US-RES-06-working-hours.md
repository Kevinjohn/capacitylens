# US-RES-06 — Use fixed resource working hours

**Area:** Resources · **Persona:** Studio manager · **Coverage:** **Unit:** `src/components/resources/ResourceForm.test.tsx` · **E2E:** `e2e/resources.spec.ts` → "uses fixed working hours without showing an hours field"

## Goal

Use one consistent capacity model: **Full day** is 8 hours, **Half day** is 4 hours and
**Not working** is 0 hours.

## Why

The working-pattern choices already express a person's availability. A separate hours-per-day
field duplicates that choice and makes the resource form harder to understand.

## How (end-to-end)

**Precondition:** Seeded app open; click **Resources** in the sidebar.

1. On the **Bruce Wayne** row, click the **Edit** (pencil) icon.
2. Confirm there is no **Working hours / day** field.
3. Choose the required Full day, Half day and Not working pattern, then click **Save**.

## Acceptance criteria

- ✅ Resource create and edit forms do not show **Working hours / day**.
- ✅ Every resource form save writes `workingHoursPerDay: 8`; editing a legacy resource with a
  custom value normalises it to 8 at that point.
- ✅ Existing stored resources are not bulk-migrated, and the compatibility field remains in the
  portable format, shared type and database.
- ✅ Resource list rows no longer show redundant _Nh/day_ text.
- ✅ On **Schedule**, Full day supplies 8 hours, Half day supplies 4 hours and Not working supplies 0.
