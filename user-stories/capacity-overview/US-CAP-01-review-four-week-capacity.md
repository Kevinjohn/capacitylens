# US-CAP-01 — Review four- or twelve-week capacity

**Area:** Overview · **Persona:** Studio manager · **Linked E2E:** `e2e/capacity-overview.spec.ts` and `e2e/capacity-overview.auth.spec.ts`

## Goal

See which active Studio and Supplementary people have capacity during the remainder of this week
and the next three full weeks, with an optional strategic view of weeks 5–12, while keeping
overload and unassigned demand visible.

## Why

A manager needs a quick planning view that answers who can take work without scanning every row of
the schedule.

## How (end-to-end)

**Precondition:** A company using Hours or Days mode is open and your role can view Overview.

1. Open **Overview** from immediately above **Schedule** in the sidebar. **4 weeks** is selected
   in the **Overview horizon** control by default.
2. Read the four tactical week columns and each group's summary. Choose **12 weeks** to keep
   those columns and add the complete **Weeks 5–8** and **Weeks 9–12** periods. The twelve-week
   range is the remainder of the current company week plus eleven complete company weeks, not
   twelve full weeks from today.
3. Choose **Hide tentative** to recalculate capacity and unassigned demand from confirmed work only
   across every displayed period.
4. Choose **Has availability** to keep people with at least 0.25 displayed free days in any shown
   period and placeholders with demand.
5. Choose **Show totals** to reveal each group header's free, overbooked and unassigned-demand figures;
   **Hide totals** is the default.
6. Choose **Bar** or **Bar & number** to see free and overbooked capacity as a fill in each cell,
   proportioned against the company working days in that column; **Number** is the default.
7. Hover or focus a person's avatar to reveal an eye icon, then select it to open that person's
   read-only schedule drawer without leaving Overview.

## Acceptance criteria

- ✅ The first column runs from today through the company's week end; three full weeks follow.
- ✅ **4 weeks** is the default. **12 weeks** adds exactly **Weeks 5–8** and **Weeks 9–12**, each
  covering four complete company weeks after the four tactical columns.
- ✅ The horizon uses the company's Monday or Sunday week start, and strategic headings show their
  period label with the actual localized date range, including year context at a rollover.
- ✅ Reopening or reloading Overview returns to **4 weeks**. Switching horizons preserves the other
  Overview controls and collapsed groups, and the horizon is not stored as company or device data.
- ✅ Active Studio and Supplementary people appear in Schedule order; external and inactive people do not.
- ✅ Fully booked and unavailable periods appear as muted dashes so available capacity is easy to scan.
- ✅ Placeholder allocations appear as separate unassigned demand when placeholders are enabled.
- ✅ Group summaries continue to cover all eligible people in that group when the row filter is on,
  including rows hidden by **Has availability**.
- ✅ Group header totals are hidden by default; **Show totals** reveals them without changing the group name or collapse control.
- ✅ Number is the default capacity display; Bar and Bar & number fill a person's cell from the
  bottom against the company working days in that column, green for free and red for overbooked,
  capped at a full cell, and use a subtle neutral grey when there is nothing to show. Number keeps
  its compact table spacing; Bar and Bar & number add 6px horizontal and vertical breathing room
  between cells for easier scanning.
- ✅ The bar never applies to group header totals or unassigned-demand rows, and every mode keeps the underlying value available to assistive technology.
- ✅ Blocks mode explains that the overview needs Hours or Days without showing capacity figures.
- ✅ Owners and Admins can choose Owner/Admin, Owner/Admin/Editor or Everyone access in Settings; the default is Owner/Admin.
- ✅ Selecting a person's avatar opens their read-only schedule drawer over the fixed 28-day window
  from its own start date, the same trigger and drawer used by the Schedule; choosing **12 weeks**
  does not expand the drawer.

See [Find capacity across four or twelve weeks](/guide/capacity-overview) for the user guide.
