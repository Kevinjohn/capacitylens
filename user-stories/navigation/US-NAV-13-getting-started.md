# US-NAV-13 — "Getting started" checklist + "Show me around" tour (first run, empty account)

**Area:** Navigation & shell · **Persona:** New owner setting up their first company · **Linked E2E:** `e2e/getting-started.spec.ts` → all four specs (seeded company never shows the card; empty company shows it and a completed step ticks itself off; "Show me around" drives the loose tour; Dismiss hides it and persists the device flag)

## Goal
On a fresh, still-empty company, the schedule shows a small **Getting started** card that walks the
owner through the four steps that make the app useful — add a client, a project, a person, then
assign them — plus a **Show me around** button that runs a short spotlight tour of where things
live (schedule, toolbar, People, Clients & projects, Settings).

## Why
An empty schedule explains nothing. The checklist is **state-driven** (each step ticks itself off
from the account's real data), so it survives the user wandering off mid-flow and never gets out of
step with reality the way a scripted do-this-now tour would. The tour is deliberately **loose** —
five look-around stops, no navigation, no forced actions — the where, not the how.

## How (end-to-end, default local mode)
**Precondition:** Start from a clean state (DevTools → Console → `localStorage.clear()` → reload).

1. Open the app, click through the demo sign-in (US-NAV-11), and create a **New company** (any
   name). Continue through the intro page (US-NAV-12).
2. The schedule shows the floating **Getting started** card over the schedule without shifting the
   toolbar or grid: four steps, all pending. The
   first three are links; the fourth (**Assign them to the project**) carries a hint about
   clicking/dragging on a person's row.
3. Click **Add your first client** → you land on the Clients page. Add a client, then return to
   **Schedule** → that step is now ticked (struck through, no longer a link); the others remain.
4. Click **Show me around** → a spotlight popover opens on the schedule grid with **Next/Back**
   buttons and a step counter. Step through all five stops (grid → toolbar → People → Clients &
   projects → Settings) → **Done** closes it. Escape at any point also closes it. The URL never
   changes during the tour.
5. Click **Dismiss** → the card disappears and does not return on this device (even for another
   still-empty company).

## Acceptance criteria
- The card (`data-testid="getting-started"`) appears on the schedule **only** when the active
  account has at least one incomplete step AND it hasn't been dismissed on this device. A fully
  set-up (seeded) company never shows it.
- The card is an overlay in the schedule chrome: showing or hiding it does not change the toolbar or
  grid's top position, and it stays within the schedule viewport at desktop and narrow widths.
- Steps derive from real data: the built-in **Internal** client does **not** tick the client step;
  any allocation ticks the assign step. Completed steps render struck-through with a check and a
  screen-reader "Done:" prefix; pending steps 1–3 are links to `/clients`, `/projects`,
  `/resources`.
- **Show me around** (`data-testid="getting-started-tour"`) opens the driver.js tour: five stops,
  translatable Next/Back/Done labels, progress counter, Escape bails, spotlighted elements are
  inert (a stray click can't navigate), and the popover follows the app theme in light AND dark.
- **Dismiss** (`data-testid="getting-started-dismiss"`) hides the card immediately and persists
  device-globally (`capacitylens/gettingStartedDismissed`, `'on'`/`'off'`, default off) — never in
  `AppData`/export, cleared by Settings → **Clear local data** like every `capacitylens/` key.
- A **Viewer** on a server-backed deploy never sees the card (every CTA is a write they can't do).
