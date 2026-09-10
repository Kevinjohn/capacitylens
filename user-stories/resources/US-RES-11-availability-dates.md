# US-RES-11 — Set a person's availability dates

**Area:** Resources · **Persona:** Studio manager · **Coverage:** `e2e/resources.spec.ts` + allocation placement checks

**Documentation:** [People and placeholders — set availability dates](../../docs-src/guide/people-and-placeholders.md#set-availability-dates)

## Goal

Set the first and last dates when a Studio or Supplementary person is available, so capacity
planning reflects a joiner, leaver or fixed-term engagement without hiding their history.

## Why

A person can be on the schedule before their start date or after their end date because the
business needs to retain the plan and its history. Availability dates make those boundaries clear:
capacity is zero outside the range, while existing allocated work remains visible for review.

## How (end-to-end)

**Precondition:** Seeded app open; click **Resources** in the sidebar.

1. On the **Bruce Wayne** row, click the **Edit** (pencil) icon. The "Edit resource" dialog opens.
2. Set **Available from** to `2026-06-08` and **Available until** to `2026-06-19`.
3. Click **Save**. The dialog closes.
4. Open **Schedule** and view the weeks containing 5 June and 22 June.
5. Try to create or move work for Bruce onto a scheduled working day before 8 June or after 19
   June. The placement is rejected and the existing booking stays where it was.
6. Return to Bruce's resource form and clear either date. Save, then confirm that side is unbounded.

## Acceptance criteria

- ✅ Resource create and edit forms show **Available from** and **Available until** only for Studio
  and Supplementary people. Placeholders and External / 3rd party resources have no availability
  date controls and retain their existing behaviour.
- ✅ Both dates are optional and inclusive. Blank **Available from** means available without a first
  date; blank **Available until** means available without a last date. Setting both to the same date
  is valid. A first date after the last date is rejected with an inline validation error.
- ✅ A person's capacity is zero outside their availability range. Allocated load remains visible,
  so narrowing a range does not delete, move or rewrite conflicting allocations.
- ✅ Metadata edits remain allowed when existing allocations conflict with the new range.
- ✅ New allocations and placement-changing edits (move, resize, reassignment or repeat occurrence
  placement) are rejected when they would place work on a scheduled working day outside the range.
  Rejection is atomic: the prior allocation and its dates remain unchanged.
- ✅ **Ignore working days** can include recurring non-working days, but it does not bypass the
  person's availability date boundaries.
