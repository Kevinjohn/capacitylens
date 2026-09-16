# US-NAV-01 — Navigate between all available sections

**Area:** Navigation & shell · **Persona:** Studio manager · **Linked E2E:** `e2e/navigation.spec.ts` → "sidebar links route to each section", "valid deep link … survives a browser reload"; `e2e/navigation.db.spec.ts` → single-company reload and picker boundaries

**Documentation:** [Settings](../../docs-src/guide/settings.md)

## Goal

Reach every part of CapacityLens from the left sidebar, so each section's screen actually loads.

## Why

The sidebar is the only way around the app. If any link is mis-wired or a screen
fails to render, that whole area of the tool is unreachable — and a manager can't
trust the schedule they can't navigate to. This story proves the available routes are live.

## How (end-to-end)

**Precondition:** Seeded app open at Schedule (`/`). (Running near the seed dates;
otherwise the bars sit in June 2026 — that doesn't affect navigation.)

1. Confirm the sidebar shows, in order: **Overview**, **Schedule**, **Resources**, **Disciplines**, **Clients**,
   **Projects**, **Activities**, **Time off**, then — below a divider, pinned to the bottom of the
   list as the administration group — **Team & access** and **Settings**. At the very bottom sits
   one avatar-led **Account** row. Real auth shows the company name, role and **Switch company** only
   when two or more companies are accessible; auth-off/demo retains the company context and switch.
2. Click **Overview**. The URL is `/overview` and its four-week table renders.
3. Click **Schedule**. The URL is `/` and the timeline grid (`scheduler-grid`) renders.
4. Click **Resources**. The URL is `/resources` and the Resource list shows
   (seed rows include _Bruce Wayne_).
5. Click **Disciplines**. The URL is `/disciplines` and the Discipline list shows
   (_Design_, _Development_, _Copywriting_).
6. Click **Clients**. The URL is `/clients` and the Client list shows (_Queen Consolidated_, _LexCorp_).
7. Click **Projects**. The URL is `/projects` and the Project list shows
   (_Project Watchtower_, _Metropolis Rebrand_).
8. Click **Activities**. The URL is `/activities` and the Activity list shows (_Wireframes_, etc.).
9. Click **Time off**. The URL is `/timeoff` and the Time-off list shows
   (_Bruce — 10–12 June (Holiday)_).
10. Click **Team & access**. The URL is `/team` and the current access summary shows.
11. Click **Settings**. The URL is `/settings` and the page shows **Company setup**,
    **Scheduling features**, **My display** and **Data and support** in order. **Company details**
    and **Diagnostics** appear in Data and support.
12. Click **Account**. The URL is `/account` and the personal identity and available security
    controls show independently of the active company.

## Acceptance criteria

- ✅ Settings keeps its four groups on one scrollable page. Group descriptions distinguish company
  settings from this browser's preferences; controls stack under their labels at narrow widths
  without horizontal page overflow. Help opens by keyboard and returns focus to its trigger.
  Coverage: `e2e/settings-layout.spec.ts`.

- ✅ Each available link routes to its mapped path, in nav order: `/overview`, `/`, `/resources`,
  `/disciplines`, `/clients`, `/projects`, `/activities`, `/timeoff`, `/team`, `/settings`, `/account`.
- ✅ **Team & access** and **Settings** are the last two links, in that order, below the divider —
  they never appear among the working destinations above it.
- ✅ The sidebar has exactly one avatar-led **Account** row at the bottom and no separate **Sign out**
  row. Real and demo sign-out is on **Account**; auth-off/local has no sign-out action.
- ✅ **Schedule** renders the scheduler grid (`data-testid="scheduler-grid"`).
- ✅ Each available destination renders its screen with at least the seeded rows /
  fields visible (e.g. _Bruce Wayne_ on Resources, _Queen Consolidated_ on Clients, the
  **Company details** heading on Settings).
- ✅ Navigating away and back (e.g. Resources → Schedule) re-renders each screen
  without a blank page or console error.
- ✅ Loading or reloading a valid destination URL serves the application shell rather than an HTTP 404. A reload with exactly one valid company opens it automatically at the originally requested
  destination. First entry, explicit **Switch company**, and multi-company reloads keep the picker.
- ✅ An unknown extensionless URL reaches the application's **Page not found** screen, while missing
  asset and API paths remain real HTTP errors rather than receiving the application shell.
