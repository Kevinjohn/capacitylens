# US-CAP-01 — Review four-week capacity

**Area:** Overview · **Persona:** Studio manager · **Linked E2E:** `e2e/capacity-overview.spec.ts` and `e2e/capacity-overview.auth.spec.ts`

## Goal

See which active Studio and Supplementary people have capacity during the remainder of this week
and the next three full weeks, while keeping overload and unassigned demand visible.

## Why

A manager needs a quick planning view that answers who can take work without scanning every row of
the schedule.

## How (end-to-end)

**Precondition:** A company using Hours or Days mode is open and your role can view Overview.

1. Open **Overview** from immediately above **Schedule** in the sidebar.
2. Read the four fixed week columns and each group's summary.
3. Choose **Hide tentative** to recalculate capacity and unassigned demand from confirmed work only.
4. Choose **Has availability** to keep people with at least 0.25 days capacity in any shown week and placeholders with demand.
5. Choose **Show totals** to reveal each group header's free, overbooked and unassigned-demand figures; **Hide totals** is the default.
6. Choose **Bar** or **Bar & number** to see free and overbooked capacity as a fill in each cell,
   proportioned against the company working days in that column; **Number** is the default.
7. Hover or focus a person's avatar to reveal an eye icon, then select it to open that person's
   read-only schedule drawer without leaving Overview.

## Acceptance criteria

- ✅ The first column runs from today through the company's week end; three full weeks follow.
- ✅ Active Studio and Supplementary people appear in Schedule order; external and inactive people do not.
- ✅ Fully booked and unavailable periods appear as muted dashes so available capacity is easy to scan.
- ✅ Placeholder allocations appear as separate unassigned demand when placeholders are enabled.
- ✅ Group summaries continue to cover all eligible people in that group when the row filter is on.
- ✅ Group header totals are hidden by default; **Show totals** reveals them without changing the group name or collapse control.
- ✅ Number is the default capacity display; Bar and Bar & number fill a person's cell from the
  bottom against the company working days in that column, green for free and red for overbooked,
  capped at a full cell, and grey when there is nothing to show.
- ✅ The bar never applies to group header totals or unassigned-demand rows, and every mode keeps the underlying value available to assistive technology.
- ✅ Blocks mode explains that the overview needs Hours or Days without showing capacity figures.
- ✅ Owners and Admins can choose Owner/Admin, Owner/Admin/Editor or Everyone access in Settings; the default is Owner/Admin.
- ✅ Selecting a person's avatar opens their read-only schedule drawer over the fixed 28-day window
  from its own start date, the same trigger and drawer used by the Schedule.

See [Find capacity for the next four weeks](/guide/capacity-overview) for the user guide.
