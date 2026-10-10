---
title: Try the demo
description: See CapacityLens running with sample data in about two minutes, with nothing installed but the repo.
---

# Try the demo

Run a sample agency's schedule on your own machine in about two minutes. Nothing is saved:
schedule changes reset when you refresh, and there is no real sign-in. Display preferences may stay
in your browser. To keep real data, [install CapacityLens](/self-hosting/install) instead.

You need [Node.js](https://nodejs.org) 24 or newer (check with `node --version`) and
[pnpm](https://pnpm.io), which `corepack` in Node provides.

## Run it

1. Clone the repository, check out a release and install dependencies:

   ```bash
   git clone https://github.com/Kevinjohn/capacitylens.git
   cd capacitylens
   git checkout vX.Y.Z
   corepack enable && pnpm install
   ```

   Replace `vX.Y.Z` with the newest tag on the
   [releases page](https://github.com/Kevinjohn/capacitylens/releases/latest). Otherwise you run
   unreleased changes on `main`.

2. Start the demo:

   ```bash
   pnpm run dev:demo
   ```

3. Open the **Local** address the command prints, usually
   [http://127.0.0.1:5173](http://127.0.0.1:5173).

No setup token, `.env` file or database is needed.

## Open the sample company

Choose the sample company on the **Choose an account** screen; there is no password. The schedule
opens with people, clients, projects and bookings already in place.

![The Schedule view with people grouped by discipline, allocation bars, utilisation percentages and a holiday block](../screenshots/flows/schedule.jpg)

## Try these first

<div class="steps">

1. ![The open schedule filter row with person search on the left and the remaining controls grouped on the right](../screenshots/flows/schedule_filters_open.png)

   **Open the filters.** Select **Show filters** at the far right of the Schedule toolbar.

2. ![The Schedule filtered to a project, with Clear Filters active in red](../screenshots/flows/schedule_filter_project.png)

   **Filter to a project.** Open **All projects** and choose one. **Clear Filters** turns red
   while the view is narrowed.

3. ![A project filter with Show unallocated selected and Diana Prince shown dimmed](../screenshots/flows/schedule_filter_unallocated.png)

   **See who is free.** Select **Show unallocated**. People without work on that project return
   as dimmed rows.

4. **Move some work.** Select **Clear Filters**, then drag a booking to another week and watch the
   [Utilisation](/reference/glossary) percentage update.

5. **Zoom out.** Change **Weeks visible** from two weeks to four or six.

</div>

<span id="what-s-next"></span>

Next: [Install CapacityLens](/self-hosting/install) — keep real data with real sign-in.
