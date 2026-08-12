---
title: The schedule
description: How to read the grid — rows, columns, colours and states — that every other CapacityLens screen feeds into.
---

# The schedule

The schedule is the one screen CapacityLens is built around: every person, every
allocation and every day of time off, all on a single zoomable grid. This page explains
what you're looking at so you can read [utilisation](/reference/glossary) at a glance
instead of clicking around to check.

![The Schedule view with people grouped by discipline, allocation bars, utilisation percentages and a holiday block](../screenshots/flows/schedule.jpg)

## Rows: your people

Each row is one [person](/reference/glossary) — a real teammate, a freelancer, or a
[placeholder](/reference/glossary) for a role you haven't filled yet. Rows are grouped
under a [discipline](/reference/glossary) heading (Design, Development, and so on) when
your company uses disciplines, which is the default. A group header can be collapsed to
`{count} hidden`, and shows an average utilisation figure for everyone in it when that
figure is turned on in Settings.

Each row starts with an avatar and name, with the person's role shown underneath. A
placeholder row is labelled with the word "Placeholder" instead of a name, and has a
faint diagonal hatch on its header so it reads as unfilled at a glance.

People marked as favourites stay at the top of their discipline, in alphabetical order.
Everyone else follows alphabetically, then placeholders. Favourite external parties lead
the separate External group. Favourites are shared with everyone in the company rather
than being a personal display preference.

## Columns: the visible weeks

Columns are days, grouped into a zoomable range of one, two, four, six or eight weeks
at a time — the **Weeks visible** dropdown in the toolbar switches between them. Use the
arrow buttons (hover for "Back one week" / "Forward one week") to pan a week at a time,
and **Today** to jump back to the current week.

Weekend columns get a faint tint when you're zoomed in close enough to see individual
days clearly. In the one- and two-week views, each month and year is centred over the
visible days it describes. Wider views keep a compact month label in sight as you scroll.

## Allocation bars

An [allocation](/reference/glossary) — a person booked on a project for a date range —
shows as a coloured bar spanning the days it covers, coloured by project or
[activity](/reference/glossary).
Three statuses are visible directly on the bar:

- **Confirmed** — a plain, solid bar. This is the default when you create one.
- **Tentative** — the same bar with a dashed border and a light diagonal hatch, so
  work that isn't locked in yet still stands out from confirmed work.
- **Completed** — the bar's label gets a checkmark prefix.

Depending on your device preferences, a bar's label can also show the client and
project name ahead of the activity name, plus the hours booked per day. Companies that
plan in Blocks don't book hours at all — see
[Projects and allocations](/guide/projects-and-allocations) for how the different
scheduling modes work.

## Reading overwork

CapacityLens never makes you run a report to find out who's overbooked:

- A **utilisation percentage** sits beside each row, and can also be shown as a
  company-wide total and a per-discipline average — all three are switches in
  [Settings](/guide/settings). A person's own percentage turns bold and red as soon as
  they're booked over capacity within the next 14 days, regardless of what's currently
  zoomed into view.
- Any day where a person is booked for more than they're available gets a red band
  under the bars for that day, so the exact day that tips someone over capacity is
  obvious without doing the maths yourself.

::: tip
The utilisation percentage itself is worked out over whatever date range is currently
visible — one, two, four, six or eight weeks. Zoom out to two weeks and a person's
percentage will usually drop, because it's now averaged over more days; zoom back to one
week and it rises again. That's expected, not a bug: the percentage always answers "how
booked is this person over the weeks I'm looking at right now?" The red over-capacity
warning is separate and doesn't move when you zoom — it always looks at the fixed next
14 days, so someone can show red even while you're viewing a wider, less-full-looking
range.
:::

## Time off on the same canvas

[Time off](/guide/time-off) — holiday, sick leave or unpaid leave — is drawn on the same
grid as work, as a hatched block with no project colour, so a person's real availability
is always visible in one place rather than hidden in a separate calendar.

## Filtering and searching

Use **Show filters** at the right of the toolbar, after Undo and Redo, to open the filter
row. You can search people by name, filter by discipline, client, project or activity,
hide tentative work, or show people with no work booked against the current filter. The
latter is useful when you're trying to find someone free to staff a project.

**Clear Filters** stays at the far right of the open row. It is quiet and disabled when
nothing is filtered, then turns red with a bin icon when a filter is active. One click
resets the search, every dropdown, **Hide tentative** and **Show unallocated**.

Every change on the schedule — dragging, resizing, deleting an allocation — can be
undone and redone from the toolbar, or with Ctrl/Cmd+Z, if you have edit access.

::: tip
Rows, colours and percentages update live as you drag. There's nothing to refresh and
nothing to recalculate — what you see is always current.
:::

## What's next

[People and placeholders](/guide/people-and-placeholders) covers who can appear on the
schedule, and [Projects and allocations](/guide/projects-and-allocations) covers how the
bars themselves get created.
