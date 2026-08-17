---
title: Try the demo
description: See CapacityLens running with sample data in about two minutes, with nothing installed but the repo.
---

# Try the demo

This page gets you looking at a working schedule in about two minutes, using a sample
agency's data. Schedule changes stay in memory and reset when you refresh. The cosmetic
signed-in state and device display preferences can stay in browser storage, but there are
no credentials or real sign-in. If you're ready to install CapacityLens for real instead,
skip to [Choose how to install CapacityLens](/getting-started/install).

You'll need [Node.js](https://nodejs.org) 24 or newer and [pnpm](https://pnpm.io) (by
way of `corepack`, which ships with Node) on your machine. Check your version with
`node --version` — if it's older than 24, install a newer one from
[nodejs.org](https://nodejs.org).

## Run it

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/Kevinjohn/capacitylens.git
   cd capacitylens
   corepack enable && pnpm install
   ```

2. Start the demo:

   ```bash
   pnpm run dev:demo
   ```

3. Open [http://127.0.0.1:5173](http://127.0.0.1:5173) in your browser.

That's it — no setup token, no `.env` file, no database.

## What you'll see

The demo starts with a cosmetic **Choose an account** screen, then loads an in-memory
sample agency with people, clients, projects and allocations already on the schedule.
Choose the sample account; no password or pop-up is involved.

![The Schedule view with people grouped by discipline, allocation bars, utilisation percentages and a holiday block](../screenshots/flows/schedule.jpg)

## What to click first

Try the things you'd do in a real resourcing meeting:

1. Select **Show filters** at the far right of the Schedule toolbar. The Work/Time off
   choice, person search and filter dropdowns appear in one row.

   ![The open schedule filter row with Work and Time off draw modes, person search and filter dropdowns](../screenshots/flows/schedule_filters_open.jpg)

2. Open **All projects** and choose **Queen Consolidated / Project Watchtower**. The
   schedule keeps matching work, and **Clear Filters** turns red to show that the view is
   narrowed.

   ![The Schedule filtered to Queen Consolidated and Project Watchtower, with Clear Filters active in red](../screenshots/flows/schedule_filter_project.jpg)

3. Select **Show unallocated**. People without Project Watchtower work return as dimmed
   rows so you can see who may be available to staff it.

   ![The Project Watchtower filter with Show unallocated selected and Diana Prince shown dimmed](../screenshots/flows/schedule_filter_unallocated.jpg)

4. Select **Clear Filters**, then drag an allocation bar to a different week and watch
   the [utilisation](/reference/glossary) percentage update.
5. Change **Weeks visible** from two weeks to four or six weeks to see how the same plan
   reads at a wider range.

Everything is editable, so there's no wrong button to press.

::: tip
Schedule data is throwaway. Refreshing the page resets it, while the cosmetic signed-in
state and device display preferences may remain on that browser. When you're ready to
keep real data, move on to
[Choose how to install CapacityLens](/getting-started/install).
:::

## What's next

[Choose how to install CapacityLens](/getting-started/install) for a persistent install
with real sign-in.
