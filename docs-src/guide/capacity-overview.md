# Find capacity across four or twelve weeks

Overview shows who can take work during the remainder of this week and the next three
full company weeks. Choose **12 weeks** when you also need two strategic four-week totals. It uses
the same working patterns, time off and company closures as the Schedule.

## Open the overview

Choose **Overview** immediately above **Schedule** in the sidebar. The table shows active
Studio and Supplementary people in the same order and groups as the Schedule. External resources
and archived or deleted people are excluded.

Each displayed period can show:

- days free;
- days overbooked, kept separate from free capacity;
- a muted dash when the person is fully booked or unavailable.

Capacity is rounded down to the nearest quarter-day. Overbooking is rounded up. Each group summary
calculates from exact values before rounding.

If placeholders are enabled, their allocations appear separately as **Unassigned demand**. This
demand is rounded up to the nearest quarter-day and is not counted as people capacity.

Hover or focus a person's avatar to reveal an eye icon. Selecting it opens that person's
read-only schedule drawer, covering the current company week and the following three weeks
rather than the Overview's own columns, without changing the table's filters or scroll
position — the same drawer as [the schedule](/guide/the-schedule).

## Choose a planning horizon

The **Overview horizon** control starts at **4 weeks**. This shows the remainder of the current
company week followed by the next three complete company weeks.

Choose **12 weeks** to keep those four tactical columns and add two complete strategic periods:

- **Weeks 5–8**, covering four consecutive complete company weeks;
- **Weeks 9–12**, covering the next four complete company weeks.

The **12 weeks** label is shorthand for the remainder of the current company week plus eleven
complete company weeks. It does not mean twelve full weeks from today. Both horizons follow the
company's Monday or Sunday week start. Strategic headings show the period label and its actual
localized date range, including the year when needed at a month or year boundary.

The choice resets to **4 weeks** when you reopen Overview or reload the page. It is temporary page
state, not a company or device preference. Switching it keeps your tentative-work, availability,
totals and display-mode choices, as well as collapsed groups.

## Filter the table

**Show tentative** starts selected. Choose **Hide tentative** to recalculate both people's capacity
and unassigned demand from confirmed allocations only.

Choose **Has availability** to show only people with at least 0.25 displayed free days in any period.
With **12 weeks** selected, the strategic periods count too, after their exact values are
aggregated and rounded for display. Placeholders remain when they have displayed demand. Each group
summary still covers all eligible people in that group, including rows hidden by this filter.

**Hide totals** starts selected and keeps group header rows to just the group name and its collapse
control. Choose **Show totals** to reveal each group's free, overbooked and unassigned-demand
figures for every displayed period, including the two four-week strategic totals in **12 weeks** mode.

## Choose a capacity display

**Number** starts selected and shows each period's figures as text, as described above. Switch to
**Bar** to see a person's free capacity as a fill that grows from the bottom of the cell,
proportioned against the company working days in that column. For a five-day company week, four
free days fill 80% of the cell and 1.5 free days fill 30%. This makes people with different working
patterns directly comparable: a fully free three-day person fills 60%, not the whole cell. The
first column uses only the company working days remaining between today and the week end.

Green fill shows free capacity; red fill shows overbooking, capped at a full cell. A person with
nothing to show, including someone fully booked or with no availability that week, keeps a subtle
neutral-grey cell. Bar modes use 6px horizontal and vertical gaps between cells so adjacent periods
and rows stay easy to distinguish.
**Bar & number** shows the fill and the figures together. The underlying value stays available to
assistive technology in every mode. Group header totals and unassigned-demand rows always show
figures only; the bar never applies to them.

Companies using Blocks mode see an explanation because Blocks do not measure capacity. Switch to
Hours or Days in **Settings** to use the overview.

## Control access

Overview is available to Owners and Admins by default. An Owner or Admin can open
**Settings**, find **Overview access**, and choose:

- **Owner and Admin only**;
- **Owner, Admin, and Editors**; or
- **Everyone**.

The chosen access applies to both the sidebar link and the direct `/overview` route.

This setting controls who can open the page, not the underlying data: everyone with sign-in
access to the company already receives the same allocations and resources through the schedule.

## What's next

[The schedule](/guide/the-schedule) explains daily planning and allocation editing. [Settings](/guide/settings)
covers the rest of the company and device options.
