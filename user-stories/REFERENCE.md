# Floaty — User-story reference (single source of truth)

This file pins the exact, current facts every user story and test script depends on:
routes, control labels, `data-testid`s, the first-run seed data, and shared conventions.
If the app changes, update this file first, then the affected stories.

> Floaty is a **local-only** resource scheduler (a small Float clone). All data lives in
> the browser's `localStorage`. There are no accounts, no network calls, no server.

---

## Launching the app (for a human tester)

1. From the project root run `npm run dev` and open <http://localhost:5173>.
2. **First run** seeds a demo dataset (see *Seed data* below). To start from the
   seeded state again, clear it: open DevTools → Console → `localStorage.clear()` → reload.
   (Clearing data inside the app does **not** re-seed — that's deliberate.)

## Navigation (left sidebar)

The sidebar links, in order, route to:

| Link label | Route | Screen |
|---|---|---|
| Schedule | `/` | Timeline scheduler |
| Resources | `/resources` | Resource list |
| Disciplines | `/disciplines` | Discipline list |
| Clients | `/clients` | Client list |
| Projects | `/projects` | Project list |
| Tasks | `/tasks` | Task list |
| Time off | `/timeoff` | Time-off list |

The **Data** section at the bottom of the sidebar has **Export JSON** and **Import JSON**.

## Seed data (first run)

- **Disciplines:** Design (order 0), Development (1), Copywriting (2).
- **Resources:**
  - *Tyler Nix* — Designer, Design, permanent, 8h, Mon–Fri.
  - *Pam Gonzalez* — PR & Brand, Copywriting, permanent, 8h, Mon–Fri.
  - *Nike Spiros* — Web Developer, Development, permanent, 8h, Mon–Fri.
  - *Alex Rivera* — Front End (freelance), Development, **freelancer**, 8h, **Mon–Wed only**.
  - *Senior Designer* — a **placeholder** (no name), Design, **bound to Project Lightning**.
- **Clients:** Acme Inc., Globex.
- **Projects:** Project Lightning (Acme), Brand Themes (Globex).
- **Phases (Project Lightning):** Discovery, Build.
- **Tasks:** Wireframes, Visual Design, CMS Review (Lightning); Brand System (Brand Themes).
- **Allocations (June 2026):** Tyler is **over-allocated on 3–4 June** (8h + 4h > 8h).
- **Time off:** Tyler — 10–12 June (Holiday).

The scheduler auto-scrolls to today on load; demo data lives in June 2026, so a tester
on a later date should **Jump to date → 2026-06-01** (or zoom out) to see the seed bars.

## Control labels (accessible names)

**Forms (modals).** Fields are labelled: `Name`, `Role`, `Type`, `Discipline`,
`Employment`, `Bound project`, `Working hours / day`, `Working days` (Mon…Sun toggle
buttons), `Colour picker` + `Colour hex value`, `Start`, `End`, `Hours / day`, `Status`,
`Note`, `Assignee`, `Project`, `Phase`, `Task`, `Resource`, `Sort order`.
Buttons: `Save`, `Cancel`, `Delete`, `Duplicate`, `Add task`. List pages have an add
button per entity: `Add resource`, `Add discipline`, `Add client`, `Add project`,
`Add task`, `Add time off`. Each list row has `Edit` and `Delete`.

**Delete confirmation** is a dialog titled `Delete <entity>?` with `Delete` and `Cancel`.
Cascade dialogs say "You can undo this with ⌘Z."

**Scheduler toolbar.** Zoom buttons `1w`/`2w`/`4w`/`6w`/`8w` (the active one has
`aria-pressed="true"`); `‹ Prev`, `Today`, `Next ›`; a `Jump to date` date input; a
draw-mode toggle `Work`/`Time off` (buttons — note "Time off" here is the *toggle*, distinct
from the "Time off" *nav link*); `Undo` and `Redo` icon buttons (`⌘Z` / `⌘⇧Z`). Filter row:
`Search people…`, `Filter by discipline`, `Filter by client`, `Filter by project`,
`Hide tentative` checkbox, `Clear` (only shown when a filter is active).

## `data-testid`s (for automated checks)

`scheduler-grid`, `scheduler-row`, `discipline-group`, `resource-lane`,
`allocation-bar`, `resize-start`, `resize-end`, `over-marker`, `unavailable-day`,
`timeoff-block`, `utilization`, `overall-utilization`, `allocation-popover`,
`scheduler-empty`, `timeoff-row`, `discipline-row`, `export-data`, `import-data`,
`import-input`. A lane carries `data-resource-id="<id>"`; a bar carries
`data-alloc-id`/`data-status`. Seed ids include `r-tyler`, `r-nike`, `r-alex`,
`r-ph-designer`, `p-acme` (Project Lightning), `p-brand` (Brand Themes), `t-wires`.

## Domain rules a tester should know

- **A project must belong to a client; a task must belong to a project.**
- **Placeholders** are bound to exactly one project and may only take tasks from it.
- **Cascade deletes:** deleting a client removes its projects → tasks → allocations;
  deleting a project removes its phases/tasks/allocations and *unbinds* (does not delete)
  placeholders; deleting a task removes its allocations; deleting a resource removes its
  allocations + time off. Deleting a **discipline** or **phase** is *non-destructive*
  (ungroups resources / ungroups tasks). All deletes are **undoable with ⌘Z**.
- **Capacity:** a day's available hours = the resource's working hours, but **0** on a
  non-working weekday or a time-off day. A day is **over-allocated** when allocated > available.
- **Utilisation %** (left column, "Load · next 2w") is a fixed **14-day forward window from
  today**, not the visible range; it turns **red** when the resource is over-allocated on any
  day in that window.
- **Validation:** required fields per form; an allocation/time-off range must be non-empty
  and not reversed (end ≥ start); hours must be > 0; colours must be 6-digit hex `#rrggbb`.

## Conventions for these stories

- Each story is **end-to-end**: it starts from a defined state (usually the seeded app)
  and is runnable by a human with no prior setup.
- **Acceptance criteria** are written as checkable assertions (✅) — a tester can tick each.
- Each story names its **Linked E2E test(s)** (file + test title) so the automated coverage
  is traceable to the manual script.
