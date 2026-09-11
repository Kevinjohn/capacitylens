# Find capacity for the next four weeks

Overview shows who can take work during the remainder of this week and the next three
full company weeks. It uses the same working patterns, time off and company closures as the
Schedule.

## Open the overview

Choose **Overview** immediately above **Schedule** in the sidebar. The table shows active
Studio and Supplementary people in the same order and groups as the Schedule. External resources
and archived or deleted people are excluded.

Each week can show:

- days free;
- days overbooked, kept separate from free capacity;
- a muted dash when the person is fully booked or unavailable.

Capacity is rounded down to the nearest quarter-day. Overbooking is rounded up. Each group summary
calculates from exact values before rounding.

If placeholders are enabled, their allocations appear separately as **Unassigned demand**. This
demand is rounded up to the nearest quarter-day and is not counted as people capacity.

## Filter the table

**Show tentative** starts selected. Choose **Hide tentative** to recalculate both people's capacity
and unassigned demand from confirmed allocations only.

Choose **Has availability** to show only people with at least 0.25 days capacity in one of the four
weeks. Placeholders remain when they have demand. Each group summary still covers all eligible
people in that group, including rows hidden by this filter.

**Hide totals** starts selected and keeps group header rows to just the group name and its collapse
control. Choose **Show totals** to reveal each group's free, overbooked and unassigned-demand
figures for every week.

## Choose a capacity display

**Number** starts selected and shows each week's figures as text, as described above. Switch to
**Bar** to see a person's free capacity as a fill that grows from the bottom of the cell,
proportioned against that person's own availability for the week — a 3-day-a-week person who is
fully free shows a full bar. Green fill shows free capacity; red fill shows overbooking, capped at
a full cell. A person with nothing to show, including someone fully booked or with no availability
that week, keeps a plain grey cell. **Bar & number** shows the fill and the figures together. The
underlying value stays available to assistive technology in every mode. Group header totals and
unassigned-demand rows always show figures only; the bar never applies to them.

Companies using Blocks mode see an explanation because Blocks do not measure capacity. Switch to
Hours or Days in **Settings** to use the overview.

## Control access

Overview is available to Owners and Admins by default. An Owner or Admin can open
**Settings**, find **Overview access**, and choose:

- **Owner and Admin only**;
- **Owner, Admin, and Editors**; or
- **Everyone**.

The chosen access applies to both the sidebar link and the direct `/overview` route.

## What's next

[The schedule](/guide/the-schedule) explains daily planning and allocation editing. [Settings](/guide/settings)
covers the rest of the company and device options.
