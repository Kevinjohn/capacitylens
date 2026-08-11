# US-NAV-01 — Navigate between all nine sections

**Area:** Navigation & shell · **Persona:** Studio manager · **Linked E2E:** `e2e/navigation.spec.ts` → "sidebar links route to each section", "valid deep link … survives a browser reload"

## Goal

Reach every part of CapacityLens from the left sidebar, so each section's screen actually loads.

## Why

The sidebar is the only way around the app. If any link is mis-wired or a screen
fails to render, that whole area of the tool is unreachable — and a manager can't
trust the schedule they can't navigate to. This story proves all nine routes are live.

## How (end-to-end)

**Precondition:** Seeded app open at Schedule (`/`). (Running near the seed dates;
otherwise the bars sit in June 2026 — that doesn't affect navigation.)

1. Confirm the sidebar shows, in order: **Schedule**, **Resources**, **Disciplines**, **Clients**,
   **Projects**, **Activities**, **Time off**, then — below a divider, pinned to the bottom of the
   list as the administration group — **Team & access** and **Settings**. Below those sits the
   account block (company name, **Switch company**, and the avatar'd **Sign out** row).
2. Click **Schedule**. The URL is `/` and the timeline grid (`scheduler-grid`) renders.
3. Click **Resources**. The URL is `/resources` and the Resource list shows
   (seed rows include _Bruce Wayne_).
4. Click **Disciplines**. The URL is `/disciplines` and the Discipline list shows
   (_Design_, _Development_, _Copywriting_).
5. Click **Clients**. The URL is `/clients` and the Client list shows (_Queen Consolidated_, _LexCorp_).
6. Click **Projects**. The URL is `/projects` and the Project list shows
   (_Project Watchtower_, _Metropolis Rebrand_).
7. Click **Activities**. The URL is `/activities` and the Activity list shows (_Wireframes_, etc.).
8. Click **Time off**. The URL is `/timeoff` and the Time-off list shows
   (_Bruce — 10–12 June (Holiday)_).
9. Click **Team & access**. The URL is `/team` and the current access summary shows.
10. Click **Settings**. The URL is `/settings` and the Settings screen shows (ending with the
    **Account Options Selected at Creation** summary).

## Acceptance criteria

- ✅ Each of the nine links routes to its mapped path, in nav order: `/`, `/resources`,
  `/disciplines`, `/clients`, `/projects`, `/activities`, `/timeoff`, `/team`, `/settings`.
- ✅ **Team & access** and **Settings** are the last two links, in that order, below the divider —
  they never appear among the working destinations above it.
- ✅ **Schedule** renders the scheduler grid (`data-testid="scheduler-grid"`).
- ✅ Each of the other eight links renders its screen with at least the seeded rows /
  fields visible (e.g. _Bruce Wayne_ on Resources, _Queen Consolidated_ on Clients, the
  **Account Options Selected at Creation** heading on Settings).
- ✅ Navigating away and back (e.g. Resources → Schedule) re-renders each screen
  without a blank page or console error.
- ✅ Loading or reloading a valid destination URL serves the application shell rather than an HTTP 404. Because the active company is intentionally session-only, the company picker appears after a
  reload; choosing a company continues to the originally requested destination.
- ✅ An unknown extensionless URL reaches the application's **Page not found** screen, while missing
  asset and API paths remain real HTTP errors rather than receiving the application shell.
