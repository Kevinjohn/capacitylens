# US-NAV-01 — Navigate between all eight sections

**Area:** Navigation & shell · **Persona:** Studio manager · **Linked E2E:** `e2e/navigation.spec.ts` → "sidebar links route to each section"

## Goal
Reach every part of Floaty from the left sidebar, so each section's screen actually loads.

## Why
The sidebar is the only way around the app. If any link is mis-wired or a screen
fails to render, that whole area of the tool is unreachable — and a manager can't
trust the schedule they can't navigate to. This story proves all eight routes are live.

## How (end-to-end)
**Precondition:** Seeded app open at Schedule (`/`). (Running near the seed dates;
otherwise the bars sit in June 2026 — that doesn't affect navigation.)
1. Confirm the sidebar shows, in order: **Schedule**, **Resources**, **Disciplines**,
   **Clients**, **Projects**, **Tasks**, **Time off**, **Settings** (and a **Data**
   section below).
2. Click **Schedule**. The URL is `/` and the timeline grid (`scheduler-grid`) renders.
3. Click **Resources**. The URL is `/resources` and the Resource list shows
   (seed rows include *Tyler Nix*).
4. Click **Disciplines**. The URL is `/disciplines` and the Discipline list shows
   (*Design*, *Development*, *Copywriting*).
5. Click **Clients**. The URL is `/clients` and the Client list shows (*Acme Inc.*, *Globex*).
6. Click **Projects**. The URL is `/projects` and the Project list shows
   (*Project Lightning*, *Brand Themes*).
7. Click **Tasks**. The URL is `/tasks` and the Task list shows (*Wireframes*, etc.).
8. Click **Time off**. The URL is `/timeoff` and the Time-off list shows
   (*Tyler — 10–12 June (Holiday)*).
9. Click **Settings**. The URL is `/settings` and the Settings screen shows (with the
   **Company name** field).

## Acceptance criteria
- ✅ Each of the eight links routes to its mapped path: `/`, `/resources`,
  `/disciplines`, `/clients`, `/projects`, `/tasks`, `/timeoff`, `/settings`.
- ✅ **Schedule** renders the scheduler grid (`data-testid="scheduler-grid"`).
- ✅ Each of the other seven links renders its screen with at least the seeded rows /
  fields visible (e.g. *Tyler Nix* on Resources, *Acme Inc.* on Clients, the
  **Company name** field on Settings).
- ✅ Navigating away and back (e.g. Resources → Schedule) re-renders each screen
  without a blank page or console error.
