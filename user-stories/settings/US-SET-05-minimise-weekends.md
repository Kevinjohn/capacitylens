# US-SET-05 — Minimise weekends on the schedule

**Area:** Settings · **Persona:** Studio manager · **Linked E2E:** `e2e/minimise-weekends.spec.ts` → "ON by default: weekend columns are narrow and labelled \"S\"", "toggling it off in Settings restores full-width Sat/Sun columns", "the choice survives a reload (device-global pref)", "a bar dragged across the narrowed weekend commits a later date (no crash)"

## Goal
Let the working week dominate the helicopter view by shrinking the Saturday and Sunday columns to a sliver — while still keeping weekends present so weekend work and bars that span them stay visible.

## Why
A studio that rarely works weekends spends a third of the timeline's width on two columns
almost nothing happens in. Narrowing Sat/Sun packs more working days on screen without
hiding the occasional weekend booking. It's a per-browser viewing choice (like the theme),
not shared account data, so each person sets it to taste. It defaults **on** — the common case.

## How (end-to-end)
**Precondition:** Seeded app open on the Schedule (clock inside the seed window — see *Seed data* in REFERENCE.md), at a fine zoom (e.g. **1w**) so per-day columns show.

1. On the Schedule, note the date header: weekdays read three-letter labels (`Mon`, `Tue`, …) and **both** weekend days read a single **"S"**. The Saturday and Sunday columns are clearly narrower than the weekday columns. A bar that spans a weekend (e.g. Pam's **Brand System**, 1–9 June) still draws as one continuous bar across the narrowed weekend.
2. Open **Settings** (sidebar). In the **Schedule** section, find the **Minimise weekends** switch — it's **on**.
3. Switch it **off**.
4. Return to **Schedule**. The weekend columns are now full width and read `Sat` / `Sun` like any weekday.
5. Switch it back **on** in Settings — the weekends narrow again.
6. (Optional) Reload the page and re-pick **Studio North**: the choice is remembered.

## Acceptance criteria
- The **Schedule** section appears between **Disciplines** and **Allocation bars** in Settings, with a single **Minimise weekends** switch (`role="switch"`, accessible name `Minimise weekends`).
- The switch defaults to **on** (`aria-checked="true"`).
- With it on (fine zoom): each weekend column is narrowed to roughly the width of a two-digit date, the weekday label for **both** Sat and Sun is just **"S"**, and the date number still shows.
- With it off: weekend columns return to full `dayWidth` and read `Sat` / `Sun`.
- Weekends are never removed — bars that start, end on, or span a weekend still render across the (narrow) weekend columns with correct widths, and a drag across a weekend lands on the intended date with no jump on release.
- Narrowing only applies at a zoom fine enough to show per-day columns; zoomed out (week blocks) the schedule is unchanged.
- The choice survives a reload in the same browser (device-global `capacitylens/minimiseWeekends`), is **not** on the account, and is **not** included in Export JSON.
