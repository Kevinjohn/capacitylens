# Floaty — User-story reference (single source of truth)

This file pins the exact, current facts every user story and test script depends on:
routes, control labels, `data-testid`s, the first-run seed data, and shared conventions.
If the app changes, update this file first, then the affected stories.

> Floaty is a **local-first** resource scheduler (a small Float clone). By default all data
> lives in the browser's `localStorage` with no login or network calls. The app is
> **multi-tenant by Account**: you pick a company on load and the whole dataset is scoped to
> it. An **optional** SQLite server (off by default, `VITE_FLOATY_API=…`) can persist data
> behind the same seam without changing any flow below. These stories run against the
> **default local mode**, signed in to the seeded **Studio North** company.

---

## Launching the app (for a human tester)

1. From the project root run `npm run dev` and open **the URL Vite prints**
   (<http://127.0.0.1:5173>; `localhost:5173` also works). If Vite exits with a
   port-in-use error, another dev server is squatting 5173 — find it with
   `lsof -nP -iTCP:5173 -sTCP:LISTEN` and kill it (strict port is deliberate).
2. **First run** seeds a demo dataset (see *Seed data* below).
3. Floaty opens on a **company picker** (you choose a tenant on every load —
   `activeAccountId` is never persisted). Pick **Studio North** to see the seeded data these
   stories describe. (A second seeded company, *Loft Digital*, is near-empty.)
4. To start from the seeded state again, clear it: open DevTools → Console →
   `localStorage.clear()` → reload. (Clearing data *inside* the app does **not** re-seed —
   that's deliberate.)
5. **If the page sticks on "Loading… / JavaScript isn't running"**, the browser is blocking
   scripts for the site (per-site JavaScript setting or a content-blocker extension — these
   also run in private windows when allowed). Enable JavaScript for the site and reload;
   no story can run without it.

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
| Settings | `/settings` | Settings (company rename, theme, utilisation toggles) |

That's **eight** sections. The **Data** section at the bottom of the sidebar has **Export
JSON** and **Import JSON**. A **Switch company** control returns to the account picker.

## Seed data (first run)

- **Accounts (companies):** **Studio North** (holds everything below — pick this one) and
  *Loft Digital* (a second tenant with one Design discipline and no work).
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
The Playwright E2E suite avoids that drift by **freezing the clock to 2026-06-03** (a date
inside the seed window) in `e2e/helpers.ts` `openApp()`, so the seed bars and the 3–4 June
over-marker are always on-screen without a jump — keep that date in step with the seed.

## Control labels (accessible names)

**Forms (modals).** Fields are labelled: `Name`, `Role`, `Type`, `Discipline`,
`Employment`, `Bound project`, `Working hours / day`, `Working days` (Mon…Sun toggle
buttons), `Colour (…)` (a swatch-picker trigger that opens a grid of preset colour
swatches, each button labelled by its hex), `Start`, `End`, `Hours / day`, `Status`,
`Note`, `Assignee`, `Project`, `Task`, `Resource`.
Buttons: `Save`, `Cancel`, `Delete`, `Duplicate`, `Add task`. List pages have an add
button per entity: `Add resource`, `Add discipline`, `Add client`, `Add project`,
`Add task`, `Add time off`. Each list row has `Edit` and `Delete`.

**Delete confirmation** is a dialog titled `Delete <entity>?` with `Delete` and `Cancel`.
Cascade dialogs say "You can undo this with ⌘Z."

**Scheduler toolbar.** Zoom buttons `1w`/`2w`/`4w`/`6w`/`8w` (the active one has
`aria-pressed="true"`); `‹ Prev`, `Today`, `Next ›`; a `Jump to date` date input; a
draw-mode toggle `Work`/`Time off` (buttons — note "Time off" here is the *toggle*, distinct
from the "Time off" *nav link*). Undo/redo are **keyboard-only** (`⌘Z` / `⌘⇧Z`) — there are no
toolbar buttons. Filter row:
`Search people…`, `Filter by discipline`, `Filter by client`, `Filter by project`,
`Hide tentative` checkbox, `Show unallocated` (shown only while a project/client filter is
active, on by default — when off, resources with no matching work are hidden instead of left
visible-but-dimmed), `Clear` (only shown when a filter is active).

## `data-testid`s (for automated checks)

`scheduler-grid`, `scheduler-row`, `discipline-group`, `resource-lane`,
`allocation-bar`, `resize-start`, `resize-end`, `over-marker`, `unavailable-day`,
`timeoff-block`, `utilization`, `overall-utilization`, `allocation-popover`,
`scheduler-empty`, `timeoff-row`, `discipline-row`, `export-data`, `import-data`,
`import-input`. A lane carries `data-resource-id="<id>"`; a bar carries
`data-alloc-id`/`data-status`. Seed ids include `r-tyler`, `r-nike`, `r-alex`,
`r-ph-designer`, `p-acme` (Project Lightning), `p-brand` (Brand Themes), `t-wires`.

## Domain rules a tester should know

- **A project must belong to a client; a task may be general (no project) or belong to a project.**
- **Placeholders** are bound to exactly one project and may take that project's tasks **plus general (no-project) tasks**.
- **Cascade deletes:** deleting a client removes its projects → tasks → allocations;
  deleting a project removes its phases/tasks/allocations and *unbinds* (does not delete)
  placeholders; deleting a task removes its allocations; deleting a resource removes its
  allocations + time off. Deleting a **discipline** or **phase** is *non-destructive*
  (ungroups resources / ungroups tasks). All deletes are **undoable with ⌘Z**.
- **Capacity:** a day's available hours = the resource's working hours, but **0** on a
  non-working weekday or a time-off day. A day is **over-allocated** when allocated > available.
- **Utilisation %** (left column, "Utilisation · next 2w") is a fixed **14-day forward window from
  today**, not the visible range; it turns **red** when the resource is over-allocated on any
  day in that window.
- **Validation:** required fields per form; an allocation/time-off range must be non-empty
  and not reversed (end ≥ start); hours must be > 0; colours are chosen from a preset
  swatch palette (always a valid 6-digit hex `#rrggbb`).

## Conventions for these stories

- Each story is **end-to-end**: it starts from a defined state (usually the seeded app)
  and is runnable by a human with no prior setup.
- **Acceptance criteria** are written as checkable assertions (✅) — a tester can tick each.
- Each story names its **Linked E2E test(s)** (file + test title) so the automated coverage
  is traceable to the manual script.
