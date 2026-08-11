# US-TOF-05 — Scan current and future time off by resource

**Area:** Time off · **Persona:** Studio manager · **Linked automated coverage:** `src/components/timeoff/timeOffView.test.ts` (week boundary, grouping and ordering), `src/components/timeoff/TimeOffList.test.tsx` (account settings, placeholders, lifecycle and permissions), `e2e/timeoff.spec.ts` → "groups current and future entries by resource"

## Goal

See one compact, forward-looking section per resource so upcoming availability changes can be
scanned without repeated names or historical holiday-ledger noise.

## Why

CapacityLens plans resourcing by week. Time off that ended before the current company week no longer
affects a forward plan, while leave already in progress still matters. Grouping each person's
entries together makes their upcoming availability readable at a glance.

## How (end-to-end)

**Precondition:** The active company has time-off entries for more than one resource, including
multiple entries for one person and an entry that ended before the current company week.

1. Open **Time off** (`/timeoff`).
2. Read the resource headings from top to bottom.
3. Within a resource section, read its time-off rows from top to bottom.
4. Edit or delete one dated row using its date-specific action.

## Acceptance criteria

- ✅ Entries are grouped into one bordered list per resource. The resource name appears once as the
  section heading, with one `timeoff-row` per entry beneath it.
- ✅ Resource sections are ordered alphabetically by displayed resource name. Entries within each
  section are ordered by start date, then end date, then a deterministic final tie-breaker.
- ✅ The boundary is the start of the current week in the active company's timezone, using that
  company's Monday/Sunday week-start setting. An entry remains visible when its end date is on or
  after the boundary; an entry that ended before it is hidden without being deleted.
- ✅ Placeholder time off still follows **Show placeholders**. An unexpected dangling resource is
  shown safely in a final **(unknown)** section. Time off beneath an archived resource remains hidden.
- ✅ Empty-state behavior is unchanged when the view filter leaves no entries.
- ✅ Each row keeps its date-specific Edit/Delete accessible name. Editing, deleting, confirmation,
  Undo and role-based mutation visibility target the correct underlying entry after sorting.
