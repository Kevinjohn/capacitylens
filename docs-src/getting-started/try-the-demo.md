---
title: Try the demo
description: See CapacityLens running with sample data in about two minutes, with nothing installed but the repo.
---

# Try the demo

This page gets you looking at a working schedule in about two minutes, using a sample
agency's data. Schedule changes stay in memory and reset when you refresh. The cosmetic
signed-in state and device display preferences can stay in browser storage, but there are
no credentials or real sign-in. If you're ready to install CapacityLens for real instead, skip to [Install
CapacityLens](/getting-started/install).

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

- Drag an allocation bar to a different week and watch the [utilisation](/reference/glossary) percentage update.
- Filter the schedule by [discipline](/reference/glossary) or client.
- Zoom the calendar out to see more weeks at once.

Everything is editable, so there's no wrong button to press.

::: tip
Schedule data is throwaway. Refreshing the page resets it, while the cosmetic signed-in
state and device display preferences may remain on that browser. When you're ready to
keep real data, move on to [Install
CapacityLens](/getting-started/install).
:::

## What's next

[Install CapacityLens](/getting-started/install) for a persistent install with real
sign-in, in about five minutes.
