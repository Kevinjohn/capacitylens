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
3. Floaty opens on a **demo sign-in** — a cosmetic, Google-style *"Choose an account"* screen
   (the **Jordan Avery** account; heading `Choose an account`). It is **not** real auth and
   has **no** popup: click the account (or "Use another account") to continue. It is shown only
   when real auth is off (the default) and is skipped once "signed in" (the choice persists
   device-globally; "Sign out" on the picker/sidebar returns to it).
4. Then the **company picker** (you choose a tenant on every load — `activeAccountId` is never
   persisted). Pick **Studio North** to see the seeded data these stories describe. (A second
   seeded company, *Loft Digital*, is near-empty.) While "signed in", the picker shows
   *"Signed in as Jordan Avery"* with a **Sign out** link.
5. To start from the seeded state again, clear it: open DevTools → Console →
   `localStorage.clear()` → reload. (Clearing data *inside* the app does **not** re-seed —
   that's deliberate.)
6. **If the page sticks on "Loading… / JavaScript isn't running"**, the browser is blocking
   scripts for the site (per-site JavaScript setting or a content-blocker extension — these
   also run in private windows when allowed). Enable JavaScript for the site and reload;
   no story can run without it.

## Navigation (left sidebar)

The sidebar links, in order, route to:

| Link label | Route | Screen |
|---|---|---|
| Schedule | `/` | Timeline scheduler |
| Resources | `/resources` | Resource list |
| External | `/external` | External / 3rd-party list |
| Disciplines | `/disciplines` | Discipline list |
| Clients | `/clients` | Client list |
| Projects | `/projects` | Project list |
| Tasks | `/tasks` | Task list |
| Time off | `/timeoff` | Time-off list |
| Settings | `/settings` | Settings (company rename, scheduling, calendar, disciplines, schedule, allocation bars, utilisation, appearance) |

That's **nine** sections by default — **eight** when the company turns disciplines off (the
**Disciplines** link is then hidden; see *Disciplines optional* under Domain rules). Each link
carries a small decorative icon (`aria-hidden`; the accessible name stays the label text). The
**Data** section (**Export JSON** / **Import JSON**) sits below the nav links. The company block —
the active company name plus a **Switch company** control (which returns to the account picker) —
is pinned to the **bottom** of the sidebar, below a divider beneath the Data section. (It used to
sit at the top; pinning it to the bottom keeps the logo + collapse toggle as the first item in
both the open menu and the collapsed rail, so the nav icons don't shift when the sidebar collapses.)

**Collapse / expand.** A toggle button at the **top-left** of the sidebar (accessible name
**Collapse menu** / **Expand menu**, with `aria-expanded`) collapses it to an icons-only rail.
The toggle sits at the same left inset as the nav icons, so the toggle + icon column keep their
x-position when collapsing — only the labels and the "Floaty" wordmark come and go. Rail icons
(`data-testid="nav-rail-item"`, one per **visible** section — so 8 when disciplines are off —
`title` = the section label, plus an instant hover tooltip) are **not** navigation — tapping any
of them just re-opens the menu; they're hidden from assistive tech (the labelled toggle is the
single accessible control). Collapsing hides
the company block and the Data section until re-opened. The choice is device-global
(`localStorage` key `floaty/sidebar`); with no stored choice the sidebar starts **open on
desktop and collapsed on small screens** (`(max-width: 767px), (max-height: 480px)` — phone
portrait or phone landscape).

**Rotate hint (portrait phones only).** On a portrait viewport ≤ 767px wide, a dismissable
dialog titled **Best in landscape** appears (over the company picker too, since that's a
phone's first contact). **Got it** (or Escape / backdrop) dismisses it for the session
(`sessionStorage` key `floaty/rotateHintDismissed`); rotating to landscape hides it. It
never appears on desktop viewports or in landscape.

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
  - *Dog Eat Cog* — an **external / 3rd party** (`r-ext-dogeatcog`): a company, no discipline/
    capacity, booked on Visual Design (Project Lightning) as a span only. Renders in the schedule's
    bottom band.
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

**Weekend columns.** By default the **Minimise weekends** display pref (Settings → Schedule,
on by default) shrinks the Saturday and Sunday columns to a sliver — just wide enough for the
date number — and their weekday label reads a single **"S"** (both Sat and Sun), so the working
week dominates the helicopter view. Weekends are not removed: people can still work weekends,
bars span across them, and the narrowing only applies at a fine enough zoom to show per-day
columns. Turn the pref off and weekends return to full width with `Sat`/`Sun` labels.

## Control labels (accessible names)

**Forms (modals).** Fields are labelled: `Name`, `Role`, `Type`, `Discipline`,
`Employment`, `Bound project`, `Working hours / day`, `Working days` (Mon…Sun toggle
buttons), `Colour (…)` (a swatch-picker trigger that opens a grid of preset colour
swatches, each button labelled by its hex), `Start`, `End`, `Hours / day`, `Status`,
`Note`, `Assignee`, `Project`, `Task`, `Resource`, plus `Company` + `Descriptor` (the External form).
Buttons: `Save`, `Cancel`, `Delete`, `Duplicate`, `Add task`. List pages have an add
button per entity: `Add resource`, `Add discipline`, `Add client`, `Add project`,
`Add task`, `Add time off`, `Add external party`. Each list row has `Edit` and `Delete`.

**Delete confirmation** is a dialog titled `Delete <entity>?` with `Delete` and `Cancel`.
Cascade dialogs say "You can undo this with ⌘Z."

**Scheduler toolbar.** Zoom buttons `1w`/`2w`/`4w`/`6w`/`8w` (the active one has
`aria-pressed="true"`); `‹ Prev`, `Today`, `Next ›`; a `Jump to date` date input; a
draw-mode toggle `Work`/`Time off` (buttons — note "Time off" here is the *toggle*, distinct
from the "Time off" *nav link*). Undo/redo are **keyboard-only** (`⌘Z` / `⌘⇧Z`) — there are no
toolbar buttons. Filter row:
`Search people…`, `Filter by discipline`, `Filter by client`, `Filter by project`,
`Hide tentative` checkbox, `Show unallocated` (shown only while a project/client filter is
active, **off by default** — filtering hides resources with no matching work; ticking it
brings them back visible-but-dimmed so you can see who's free to staff), `Clear` (only shown
when a filter is active).

**Schedule display (minimise weekends).** Settings → **Schedule** has a single switch
**Minimise weekends** (`role="switch"`, accessible name `Minimise weekends`), **on** by default.
It's a **device-global** display pref (own `localStorage` key `floaty/minimiseWeekends`, NOT on the
account and NOT in export) — like the theme and bar-label toggles. On → narrow Sat/Sun columns
with a single **"S"** label; off → full-width weekend columns labelled `Sat`/`Sun`. See *Weekend
columns* above.

**Allocation bars.** A bar's label reads `Client · Project · Task · Nh` (hours hidden in
blocks mode; a `✓ ` prefix when completed, a trailing ` •` when it has a note). The client
and project parts are device-global toggles in Settings → **Allocation bars** — switches
`Show client name` and `Show project name`, both **on** by default; a bar whose task has no
project (or whose toggle is off) just skips that part. The hover/focus popover keeps its own
task-first layout regardless of these toggles.

**Disciplines (account-level).** Settings → **Disciplines** has a single switch **Use disciplines**
(on by default). Turning it off hides disciplines across the whole app — the **Disciplines** nav
link and route (a direct `/disciplines` URL redirects to `/`), the **Discipline** field in the
resource form, the **Filter by discipline** control, the discipline part of each Resources-list
row, the Disciplines command-palette entry, and the **Show Discipline Utilisation** toggle — and
the schedule then renders **flat** (no `discipline-group` bands). It's stored on the account
(`disciplinesEnabled`, syncs + exports), so it applies to everyone on that company; the discipline
data itself is kept and reappears if switched back on. Both seed companies leave it on.

**Build stamp + feedback link (Settings, flag-gated).** When the build sets
`VITE_FLOATY_BUILD_SHA`, the Settings page ends with a muted one-line footer containing the
stamp (`data-testid="build-stamp"`) reading `build <sha> · server` (a server backend is
configured, i.e. `VITE_FLOATY_API` was baked in) or `build <sha> · local` (localStorage
mode). When the build also sets `VITE_FLOATY_FEEDBACK_MAILTO`, a **Send feedback** link
(`data-testid="send-feedback"`) sits beside the stamp — a `mailto:` whose subject carries
the build stamp, so reports arrive pinned to a build. The default dev/local build leaves
both variables unset and renders **nothing** — the seeded state these stories run against
has no footer at all.

**Login screen (flag-gated; not reachable in the default deploy).** Only when the app runs in
server mode (`VITE_FLOATY_API` set) **and** that server runs with `FLOATY_AUTH=password` or
`sso`: the app checks `GET /api/auth/me` once at boot, and a 401 replaces everything — company
picker included — with a **Sign in** screen (heading `Sign in`; fields `Email` + `Password`
and a `Sign in` button in password mode; a `Continue with SSO` button in sso mode; failures
show an inline alert). While signed in, Settings gains an **Account** section showing who is
signed in plus a `Sign out` button. With auth off (the default everywhere) or in local mode,
no login screen exists, Settings has no Account section, and local mode makes **no** auth
request at all. The server's reported `authMode` is the single source of truth — there is no
client-side auth flag.

**Demo sign-in (cosmetic; not real auth).** In the default (auth-off) deploy, a Google-style
*"Choose an account"* screen (heading `Choose an account`; the **Jordan Avery** account row,
`data-testid="fake-sign-in"`; a "Use another account" row) is shown **before** the company
picker, to preview a "log in first, then pick a company" flow. There is no password and no
popup — any choice just advances. The signed-in state is a **device-global** flag
(`floaty/fakeSignedIn`, default off; never in `AppData`/export), so it persists across reloads
and is cleared by **Sign out** (on the picker and the sidebar footer). It is mounted only when
`authMode === 'off'`, so it never collides with the real login wall above. The persona lives in
`src/lib/fakeAuth.ts` (avatar: `src/assets/avatar-demo.svg`).

## Command palette

Opened by **⌘K / Ctrl+K** from anywhere in the app (including while a text field is focused).
**Exception:** if a dialog has unsaved changes (`dirtyForm` is true), ⌘K/Ctrl+K is blocked —
a notice appears ("You have unsaved changes — use Cancel or Save to close this dialog.") and
the palette does **not** open. Closing or saving the dialog re-enables the shortcut.
Closed by **Escape**, backdrop click, or selecting an item.

**Sections shown (no query):** Actions ("Go to today"), Pages (all 9 routes; 8 — no Disciplines — when the company turns disciplines off).
**Sections shown (with query):** any of the above that match, plus People, Projects, Clients, Tasks.
**Special action:** typing a valid, real calendar ISO date (`YYYY-MM-DD`, zero-padded,
e.g. `2026-06-03`) shows "Go to date YYYY-MM-DD". Impossible dates like `2026-02-31`,
unpadded dates like `2026-6-3`, and out-of-range months/days are rejected.

**Selection behaviours:**
- Page item → navigate to that route.
- "Go to today" → navigate to `/` + recenter the scheduler on this week.
- "Go to date YYYY-MM-DD" → navigate to `/` + scroll the scheduler to that date.
- Person item → navigate to `/` + clear filters + scroll that resource's row into view.
- Project item → navigate to `/` + **replace** schedule filters with `{ projectId }` (all other
  filters — search, discipline, client, hideTentative, showUnmatched — are reset to defaults).
- Client item → navigate to `/` + **replace** schedule filters with `{ clientId }` (same reset).
- Task item → navigate to `/tasks`.

**Keyboard navigation:** `ArrowUp`/`ArrowDown` move the highlight; `Enter` selects; `Escape` closes.
Mouse hover sets the active option; mouse click selects.

## `data-testid`s (for automated checks)

`scheduler-grid`, `scheduler-row`, `discipline-group`, `resource-lane`,
`allocation-bar`, `resize-start`, `resize-end`, `over-marker`, `unavailable-day`,
`timeoff-block`, `utilization`, `overall-utilization`, `allocation-popover`,
`scheduler-empty`, `timeoff-row`, `discipline-row`, `external-row`, `export-data`, `import-data`,
`import-input`, `fake-sign-in` (the demo sign-in's account row — auth-off deploys only),
`build-stamp` (Settings footer; only rendered when the build sets
`VITE_FLOATY_BUILD_SHA`), `send-feedback` (Settings footer mailto; only when the build sets
`VITE_FLOATY_FEEDBACK_MAILTO`). A lane carries `data-resource-id="<id>"`; a bar carries
`data-alloc-id`/`data-status`. Seed ids include `r-tyler`, `r-nike`, `r-alex`,
`r-ph-designer`, `r-ext-dogeatcog` (external party), `p-acme` (Project Lightning), `p-brand` (Brand Themes), `t-wires`.

**Command palette:** `command-palette` (outer backdrop), `command-palette-input` (search field),
`command-palette-option` (each result item; multiple).

## Domain rules a tester should know

- **A project must belong to a client; a task may be general (no project) or belong to a project.**
- **Placeholders** are bound to exactly one project and may take that project's tasks **plus general (no-project) tasks**.
- **External / 3rd parties** are a resource kind for outsourced work: a **company name** (+ optional
  descriptor), managed on the **External** tab (not Resources), assignable to **any** task with **no
  hours**, shown in a **neutral band at the bottom of the schedule** with **no utilisation / over-markers**.
  Their allocations carry `hoursPerDay: 0` (a span, not a load); they're excluded from the Time-off picker.
- **Cascade deletes:** deleting a client removes its projects → tasks → allocations;
  deleting a project removes its phases/tasks/allocations and *unbinds* (does not delete)
  placeholders; deleting a task removes its allocations; deleting a resource removes its
  allocations + time off. Deleting a **discipline** or **phase** is *non-destructive*
  (ungroups resources / ungroups tasks). All deletes are **undoable with ⌘Z**.
- **Disciplines are optional (account-level).** Default **on**. When a company turns them off
  (Settings → Disciplines → *Use disciplines*) disciplines are hidden everywhere and the schedule
  renders flat — see the *Disciplines (account-level)* note above. The seed companies leave it
  **on**, so every story below runs with disciplines visible.
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
