# US-CAP-01 — Review four-, eight- or twelve-week capacity

**Area:** Overview · **Persona:** Studio manager · **Linked E2E:** `e2e/capacity-overview.spec.ts` and `e2e/capacity-overview.auth.spec.ts`

## Goal

See which active Studio and Supplementary people have capacity during the remainder of this week
and the complete weeks that follow, week by week, while keeping tentative work, overload and
unassigned demand visible.

## Why

A manager needs a quick planning view that answers who can take work without scanning every row of
the schedule.

## How (end-to-end)

**Precondition:** A company using Hours or Days mode is open and your role can view Overview.

1. Open **Overview** from immediately above **Schedule** in the sidebar. The page is one card
   holding one table; the subtitle states the horizon in use. **Ledger**, **4 weeks** and
   **Tentative** are selected by default; **Has availability** and **Totals** are off.
2. Read each person's week cells: free days out of capacity (**2d / 5d**), a bar filled with the
   share of capacity still free (green at 80% or more, amber at 40% or more, red below), and a grey
   hatch for the free time that tentative work holds. A muted dash marks a week with nothing free.
   An overbooked week prints the overbooked days in red beside the value; its bar keeps showing
   only the free share, so overbooking never paints it.
3. Choose **Load curve** to replace each cell's figures with a vertical fill of the same shares,
   hovering a cell for its figures. Choose **Ledger** to return.
4. Choose **8 weeks** or **12 weeks** to add complete company weeks, one column each; scroll the
   table horizontally to reach the added columns.
5. Turn **Tentative** off to recalculate capacity and unassigned demand from confirmed work only
   across every displayed week; the hatch disappears everywhere.
6. Turn **Has availability** on to keep people with at least 0.25 displayed free days in any shown
   week and placeholders with demand.
7. Turn **Totals** on to add a header row with each week's committed percentage, free days and a
   committed-plus-tentative bar across the people currently shown.
8. Hover or focus a person's avatar to reveal an eye icon, then select it to open that person's
   read-only schedule drawer without leaving Overview.

## Acceptance criteria

- ✅ The first column runs from today through the company's week end; complete company weeks
  follow to the chosen horizon: four, eight or twelve columns in total.
- ✅ **4 weeks** is the default. The horizon uses the company's Monday or Sunday week start, and
  every column heading shows its date range.
- ✅ Reopening or reloading Overview returns to **4 weeks**. Switching horizons preserves the other
  Overview controls and collapsed groups, and the horizon is not stored as company or device data.
- ✅ Active Studio and Supplementary people appear in Schedule order; external and inactive people do
  not. Each group row names the group and its number of people and collapses on selection.
- ✅ A person's capacity for a week is their own available days; the free share, tentative share
  and colour thresholds scale to it, so a three-day person and a partial first week read on the
  same scale as a five-day week.
- ✅ Tentative work appears only as the grey hatch, clamped so free plus tentative never exceeds the
  bar. Amber only ever means low availability.
- ✅ Fully booked and unavailable weeks show a muted dash. An overbooked week prints its overbooked
  days in red (Ledger) and repeats the figures in hover and screen-reader text; the bar never
  paints overbooking.
- ✅ Placeholder allocations appear as separate unassigned demand when placeholders are enabled and
  never carry a bar.
- ✅ **Totals** is off by default. Turning it on adds a header tier whose person cell stays empty,
  so no column width changes; its figures cover only the people shown after **Has availability**.
  The committed percentage turns red once committed plus tentative reaches 90%.
- ✅ Switching **Ledger** and **Load curve** changes only the inside of week cells: header, group
  rows and column widths are untouched, and every figure remains available to assistive technology.
- ✅ Blocks mode explains that the overview needs Hours or Days without showing capacity figures.
- ✅ Owners and Admins can choose Owner/Admin, Owner/Admin/Editor or Everyone access in Settings; the default is Owner/Admin.
- ✅ Selecting a person's avatar opens their read-only schedule drawer over the fixed 28-day window
  from its own start date, the same trigger and drawer used by the Schedule; the horizon does not
  change the drawer.

See [Find capacity across four, eight or twelve weeks](/guide/capacity-overview) for the user guide.
