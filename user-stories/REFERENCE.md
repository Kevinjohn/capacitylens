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
5. Then a one-time **"What Floaty is" intro page** (heading `Welcome to Floaty`) — a minimal
   post-login explainer that Floaty is a resourcing tool, not a project-management tool. Click
   **Continue** (`data-testid="intro-continue"`) to enter the app. It shows once per device
   (`floaty/introSeen`, default off, never in `AppData`/export) and is skipped thereafter. The
   wording is **placeholder copy** (single-sourced in `src/lib/introCopy.ts`), pending a human edit.
6. To start from the seeded state again, clear it: open DevTools → Console →
   `localStorage.clear()` → reload. (Clearing data *inside* the app does **not** re-seed —
   that's deliberate.)
7. **If the page sticks on "Loading… / JavaScript isn't running"**, the browser is blocking
   scripts for the site (per-site JavaScript setting or a content-blocker extension — these
   also run in private windows when allowed). Enable JavaScript for the site and reload;
   no story can run without it.

## Navigation (left sidebar)

The sidebar links, in order, route to:

| Link label | Route | Screen |
|---|---|---|
| Schedule | `/` | Timeline scheduler |
| Resources | `/resources` | Resource list (incl. the **External** section when enabled) |
| Disciplines | `/disciplines` | Discipline list |
| Clients | `/clients` | Client list |
| Projects | `/projects` | Project list |
| Activities | `/activities` | Activity list |
| Time off | `/timeoff` | Time-off list |
| Settings | `/settings` | Settings (company rename, scheduling, calendar, disciplines, schedule, allocation bars, utilisation, appearance, local data) |

That's **eight** sections by default — **seven** when the company turns disciplines off (the
**Disciplines** link is then hidden; see *Disciplines optional* under Domain rules). External / 3rd
parties no longer have their own nav link — they moved INTO the **Resources** tab behind a setting
(see *External / 3rd parties* under Domain rules); the old `/external` URL still resolves but
**redirects to `/resources`** so saved bookmarks don't 404. Each link
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
(`data-testid="nav-rail-item"`, one per **visible** section — so 8 with disciplines on, 7 when disciplines are off —
`data-label` = the section label; each shows an instant visual hover label to the right) are **not** navigation — tapping any
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
  - *Senior Designer* — a **placeholder** (no name), Design, **bound to Project Lightning**. Shown
    as the literal name **"Placeholder"** with a **"?"** avatar. **Hidden by default** — placeholders
    are behind the per-account **Show placeholders** pref (Settings → Placeholders, default **off**);
    enable it to see this row in the schedule, the Resources list, and the assignee picker.
  - *Dog Eat Cog* — an **external / 3rd party** (`r-ext-dogeatcog`): a company, no discipline/
    capacity, booked on Visual Design (Project Lightning) as a span only. **Hidden by default** —
    externals are behind the per-account **Show external resources** pref (Settings → External,
    default **off**); enable it to see this row in the schedule's bottom band, the **External** section
    of the Resources tab, and the assignee picker.
- **Clients:** Acme Inc., Globex. (**Internal** is the built-in, one per account — it is **HIDDEN
  from the Clients management list**, but still selectable as a project's client and a "Filter by
  client" option; see the Internal-client appendix below.)
- **Projects:** Project Lightning (Acme), Brand Themes (Globex).
- **Phases (Project Lightning):** Discovery, Build.
- **Activities** (every activity has a **kind**): *Project* — Wireframes, Visual Design, CMS Review
  (Lightning), Brand System (Brand Themes); *Internal* — Admin / Internal; *Repeatable* —
  Design, Workshop. "Design" is also booked for Alex (8–10 June) to demo the activity lens.
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
buttons), `Colour (…)` (a swatch-picker trigger — its name carries the current colour, e.g.
`Colour (Blue dark)` for a known swatch, else the raw hex — that opens a grid of preset
colour swatches, each button labelled by a human-readable name like `Blue dark` /
`Red bright`, not a hex), `Start`, `End`, `Hours / day`, `Status`,
`Note`, `Assignee`, `Project`, `Activity`, `Resource`, plus `Company` + `Descriptor` (the External form).
The **activity form** has an `Activity kind` radiogroup (`Project` / `Internal` / `Repeatable`); the
`Project` field shows (and is required) only for the `Project` kind — internal/repeatable
activities are project-less.
Buttons: `Save`, `Cancel`, `Delete`, `Duplicate`, `Add activity`. The **create / "Add"**
affordances carry a leading **`+`** glyph before the label (decorative, `aria-hidden`; the
accessible name stays the label text). List pages have an add button per entity: `Add resource`,
`Add discipline`, `Add client`, `Add project`, `Add activity`, `Add time off`,
`Add external party` (plus the company picker's `New company`). Each list row has an **icon-only**
`Edit` (pencil) and `Delete` (trash) button — the glyph is decorative and the button's
`aria-label`/`title` carry the name (`Edit` / `Delete`, or `Delete <name>` on the company picker),
so `getByRole('button', { name: 'Edit' | 'Delete' })` still matches.

**Delete confirmation** is a dialog titled `Delete <entity>?` with `Delete` and `Cancel` (these
dialog/footer action buttons keep their text — only the list-row actions are icon-only).
Cascade dialogs say "You can undo this with ⌘Z."

**Scheduler toolbar.** Zoom buttons `1w`/`2w`/`4w`/`6w`/`8w` (the active one has
`aria-pressed="true"`); `‹ Prev`, `Today`, `Next ›`; a `Jump to date` date input; a
draw-mode toggle `Work`/`Time off` (buttons — note "Time off" here is the *toggle*, distinct
from the "Time off" *nav link*). Then **Undo**/**Redo** icon buttons (`undo-button` /
`redo-button`, `aria-label` "Undo"/"Redo", disabled when the history stack is empty) — the
visible counterpart to the global ⌘Z / ⌘⇧Z shortcut. **In `Time off` mode the grid signals the mode whole-view:
work allocation bars recede to a flat neutral (the theme-aware `var(--color-muted)` token, which adapts to light/dark) at 20% opacity AND go fully *inert* (not
clickable/draggable, no hover popover, not tab-reachable), while existing time-off blocks glow
amber — so a lane draw books time off without the bars intercepting the gesture (a draw started
over an existing allocation falls through to the lane). The grid carries
`data-draw-mode="work"|"timeoff"`; nothing about the underlying data changes.** Undo/redo run
from BOTH the toolbar **Undo**/**Redo** buttons (above) AND the global `⌘Z` / `⌘⇧Z` shortcut. Filter row:
`Search people…`, `Filter by discipline`, `Filter by client`, `Filter by project`,
`Filter by activity` (a grouped dropdown — `All activities`, then an `Internal` optgroup with
`Internal — All` + each internal activity, then a `Repeatable` optgroup with `Repeatable — All` +
each repeatable activity; shown only when the account has internal/repeatable activities. Project activities
are reached via `Filter by project`). The activity lens is a **standalone** view: selecting it
clears the client/project filter and vice-versa. `Hide tentative` checkbox, `Show unallocated`
(shown only while a client/project/activity filter is active, **off by default** — filtering hides
resources with no matching work; ticking it brings them back visible-but-dimmed so you can see
who's free to staff), `Clear` (only shown when a filter is active).

**Schedule display (minimise weekends).** Settings → **Schedule** has a single switch
**Minimise weekends** (`role="switch"`, accessible name `Minimise weekends`), **on** by default.
It's a **device-global** display pref (own `localStorage` key `floaty/minimiseWeekends`, NOT on the
account and NOT in export) — like the theme and bar-label toggles. On → narrow Sat/Sun columns
with a single **"S"** label; off → full-width weekend columns labelled `Sat`/`Sun`. See *Weekend
columns* above.

**Placeholders (per-account, default OFF).** Settings → **Placeholders** has a single switch
**Show placeholders** (`role="switch"`, accessible name `Show placeholders`), **off** by default.
It's a **per-account** setting (`placeholdersEnabled` on the Account, absent = off, toggled via
`updateAccount` — mirroring `disciplinesEnabled`; carried in export like other account settings). **Off** (the out-of-the-box state) → every placeholder is hidden:
no row in the schedule (and no contribution to utilisation), no entry in the assignee picker or
command palette, and the Resources page hides its *Placeholders* section + *Add placeholder* button.
The **Time off** views honour it too: the Time-off list hides any time-off entry whose resource is a
placeholder, and the Time-off form's Resource picker omits placeholders.
The placeholder DATA is untouched — flipping the switch on brings the rows back (and the hidden
time-off entries reappear). **On** → a placeholder shows the literal name **"Placeholder"** with a
**"?"** avatar (its role/discipline is the secondary text); the assignee picker labels it
**"Placeholder (slot)"**, and the Time-off list/picker show it as **"Placeholder"**. Editing an
allocation **or a time-off entry** that already targets a placeholder keeps that placeholder
selectable in the picker even while the pref is off, so editing never silently reassigns the work.

**Allocation bars.** A bar's label reads `Client · Project · Activity · Nh` (hours hidden in
blocks mode; a `✓ ` prefix when completed, a trailing ` •` when it has a note). The client
and project parts are device-global toggles in Settings → **Allocation bars** — switches
`Show client name` and `Show project name`, both **on** by default; a bar whose activity has no
project (or whose toggle is off) just skips that part. The hover/focus popover keeps its own
activity-first layout regardless of these toggles.

**Disciplines (account-level).** Settings → **Disciplines** has a single switch **Use disciplines**
(on by default). Turning it off hides disciplines across the whole app — the **Disciplines** nav
link and route (a direct `/disciplines` URL redirects to `/`), the **Discipline** field in the
resource form, the **Filter by discipline** control, the discipline part of each Resources-list
row, the Disciplines command-palette entry, and the **Show Discipline Utilisation** toggle — and
the schedule then renders **flat** (no `discipline-group` bands). It's stored on the account
(`disciplinesEnabled`, syncs + exports), so it applies to everyone on that company; the discipline
data itself is kept and reappears if switched back on. Both seed companies leave it on.

**Clear local storage (Settings → Local data).** A destructive maintenance action in a danger-styled
**Local data** section near the bottom of Settings: a `Clear local storage` button
(`data-testid="clear-local-storage"`). Clicking it opens the standard confirm dialog (title
`Clear local storage?`, danger `Clear local storage` confirm + `Cancel`) whose copy depends on the
backend — in **server mode** (`VITE_FLOATY_API` set) it says your data lives in the database and is
safe, the app will reload and re-load it from there; in **local mode** it says this is your only copy
so it erases your local data. Both say it clears Floaty data + settings in **THIS browser** and
**cannot be undone**. Confirm removes every `floaty/`-prefixed localStorage key (the data blob + all
device prefs — unrelated origin keys are left alone) and reloads the page. **Cancel is a no-op.**

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

**Post-login intro page ("What Floaty is").** After a company is chosen — in **every** entry mode
(real auth, the cosmetic demo sign-in, and the no-auth default all converge on a chosen account) —
a minimal full-screen page (heading `Welcome to Floaty`) explains Floaty is a **resourcing tool**,
not a project-management tool, before the app proper. It has a single **Continue** button
(`data-testid="intro-continue"`). Shown **once per device** (`floaty/introSeen`, default off; never
in `AppData`/export) and skipped thereafter — so it does not reappear on reload. The copy is
**placeholder** (a human edits it later), single-sourced in `src/lib/introCopy.ts`; the component is
`src/components/IntroPage.tsx`. Spec `e2e/fake-signin.spec.ts` (and `e2e/login.auth.spec.ts` for the
real-auth path).

## Command palette

Opened by **⌘K / Ctrl+K** from anywhere in the app (including while a text field is focused).
**Exception:** if a dialog has unsaved changes (`dirtyForm` is true), ⌘K/Ctrl+K is blocked —
a notice appears ("You have unsaved changes — use Cancel or Save to close this dialog.") and
the palette does **not** open. Closing or saving the dialog re-enables the shortcut.
Closed by **Escape**, backdrop click, or selecting an item.

**Sections shown (no query):** Actions ("Go to today"), Pages (all 8 routes; 7 — no Disciplines — when the company turns disciplines off).
**Sections shown (with query):** any of the above that match, plus People, Projects, Clients, Activities.
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
- Activity item → navigate to `/activities`.

**Keyboard navigation:** `ArrowUp`/`ArrowDown` move the highlight; `Enter` selects; `Escape` closes.
Mouse hover sets the active option; mouse click selects.

## `data-testid`s (for automated checks)

`scheduler-grid`, `scheduler-row`, `discipline-group`, `resource-lane`,
`allocation-bar`, `resize-start`, `resize-end`, `over-marker`, `unavailable-day`,
`timeoff-block`, `utilization`, `overall-utilization`, `allocation-popover`,
`scheduler-empty`, `timeoff-row`, `discipline-row`, `external-row`, `export-data`, `import-data`,
`import-input`, `fake-sign-in` (the demo sign-in's account row — auth-off deploys only),
`intro-continue` (the post-login "What Floaty is" page's Continue button; shown once per device),
`clear-local-storage` (Settings → Local data danger button; opens a destructive confirm),
`build-stamp` (Settings footer; only rendered when the build sets
`VITE_FLOATY_BUILD_SHA`), `send-feedback` (Settings footer mailto; only when the build sets
`VITE_FLOATY_FEEDBACK_MAILTO`). A lane carries `data-resource-id="<id>"`; a bar carries
`data-alloc-id`/`data-status`. Seed ids include `r-tyler`, `r-nike`, `r-alex`,
`r-ph-designer`, `r-ext-dogeatcog` (external party), `p-acme` (Project Lightning), `p-brand` (Brand Themes), `t-wires`.

**Command palette:** `command-palette` (outer backdrop), `command-palette-input` (search field),
`command-palette-option` (each result item; multiple).

## Domain rules a tester should know

- **A project must belong to a client. An activity has a `kind`:** `project` (belongs to a project,
  may carry a phase), `internal` (project-less internal work), or `repeatable` (project-less,
  reusable across projects). Internal/repeatable activities carry no project or phase. The Activities page
  shows three sections — `internal-activities`, `repeatable-activities`, `project-activities` (testids).
- **The built-in "Internal" client.** Every account has exactly one **built-in** client named
  **Internal** (the store rejects renaming/deleting it; the write boundary also rejects a direct API write
  that would create a *second* Internal, so the one-per-account rule holds on every path). It is a behind-the-scenes data anchor, so it
  is **HIDDEN from the Clients management list** (`/clients` shows no Internal row) — but it stays a
  real, persisted client that is **still selectable and bindable everywhere it's used:** in the
  **project form's Client `<select>`** (a project can be created under Internal), as a **Filter by
  client → Internal** option, and as a **Clients** entry in the command palette; a project bound to
  Internal still shows "· Internal" as its client in the Projects list. It can own real projects, AND a
  project-less internal/repeatable activity is **bucketed under it for display + filtering** (its
  bars/labels read "Internal", and **Filter by client → Internal** shows BOTH the project-less
  activities AND any activities under Internal-owned projects). No `clientId` is stored on the
  activity; the association is derived in the view-model.
- **Placeholders** are bound to exactly one project and may take that project's activities **plus any
  project-less (internal/repeatable) activity**. They are **hidden by default** behind the
  per-account **Show placeholders** pref (Settings → Placeholders, `placeholdersEnabled` on the
  Account, default off); when shown they display as the literal name **"Placeholder"** with a **"?"** avatar.
- **External / 3rd parties** are a resource kind for outsourced work: a **company name** (+ optional
  descriptor), assignable to **any** activity with **no hours**, shown in a **neutral band at the bottom
  of the schedule** with **no utilisation / over-markers**. Their allocations carry `hoursPerDay: 0`
  and are a **literal start/end span** (`ignoreWeekends: true` — the "Include weekends" toggle is
  hidden, weekends count as plain calendar days); they're excluded from the Time-off picker, and the
  write boundary rejects time off OR a non-zero load for an external on *any* path (a direct/crafted
  write is rejected; an import is repaired — external time off dropped, external load coerced to 0). They are
  **hidden by default** behind the per-account **Show external resources** pref (Settings → External,
  `externalEnabled` on the Account, default off); when on, an **External** section appears under the **Resources**
  tab (with explainer copy + an `Add external party` button) and the band appears on the schedule. When
  off they're hidden everywhere (schedule band, assignee picker, command palette, Resources tab) but
  their data is kept. The old standalone `/external` route now **redirects to `/resources`**.
- **Cascade deletes:** deleting a client removes its projects → activities → allocations;
  deleting a project removes its phases/activities/allocations and *unbinds* (does not delete)
  placeholders; deleting an activity removes its allocations; deleting a resource removes its
  allocations + time off. Deleting a **discipline** or **phase** is *non-destructive*
  (ungroups resources / ungroups activities). All deletes are **undoable with ⌘Z**.
- **Disciplines are optional (account-level).** Default **on**. When a company turns them off
  (Settings → Disciplines → *Use disciplines*) disciplines are hidden everywhere and the schedule
  renders flat — see the *Disciplines (account-level)* note above. The seed companies leave it
  **on**, so every story below runs with disciplines visible.
- **Capacity:** a day's available hours = the resource's working hours, but **0** on a
  non-working weekday or a time-off day. A day is **over-allocated** when allocated > available
  (STRICTLY greater — exactly at capacity is NOT over). Allocated hours are **weekend-aware**: a
  normal allocation does no work on the resource's non-working weekdays, so a weekend a bar merely
  **spans** is NOT over (it keeps only the grey unavailable tint). The zero-capacity days that DO
  read as over are a **time-off** day a working allocation covers, and a weekend an allocation opts
  into via **"Include weekends as working days"** (`ignoreWeekends`). An over-allocated day renders
  with a **clear red background** (`data-testid="over-marker"`, `title="Overbooked"`) plus a solid
  red top band, in both light and dark themes.
- **An allocation can't exceed 24h/day, and the form says so instead of silently trimming it.** In
  **days mode**, a *Days of work* spread over too few *Days over* (e.g. 5 days of work in a 1-day span =
  40h/day) is **rejected** ("That's more than 24h a day. Increase Days over or reduce Days of work.")
  rather than saved as a quietly-clamped 24h; **hourly mode** likewise rejects a *Hours / day* above 24.
  The previewed "…h/day" hint always equals what saves.
- **Utilisation %** (left-column label "Utilisation · Nw" where N tracks the week-range toggle, and
  each discipline header's "N% avg utilisation") is computed over the currently **VISIBLE window** —
  the 1/2/4/8-week range anchored at the left edge of the view — so **switching the range toggle
  recomputes it** to reflect exactly the visible span. It turns **red** when the resource trips its
  separate **fixed forward 14-day** "over soon" radar (over-allocated on any working day in the next
  14 days from today); that red flag stays on the fixed window regardless of zoom/pan, distinct from
  the zoomable %.
- **Validation:** required fields per form; an allocation/time-off range must be non-empty
  and not reversed (end ≥ start); hours must be > 0; colours are chosen from a preset
  swatch palette (always a valid 6-digit hex `#rrggbb`).

## Conventions for these stories

- Each story is **end-to-end**: it starts from a defined state (usually the seeded app)
  and is runnable by a human with no prior setup.
- **Acceptance criteria** are written as checkable assertions (✅) — a tester can tick each.
- Each story names its **Linked E2E test(s)** (file + test title) so the automated coverage
  is traceable to the manual script.
