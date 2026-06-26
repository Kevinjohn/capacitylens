# Changelog

All notable changes to CapacityLens are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/) — while pre-1.0, **minor** versions carry
new features and **patch** versions carry fixes.

## [Unreleased]

## [0.11.0] — 2026-06-26

Server-backed persistence is now the default everywhere; the in-browser localStorage build
becomes an explicit, named demo.

### Changed
- **Server-backed by default.** An unconfigured build now runs in server mode against a
  same-origin `/api` (the deployed product already did this). `VITE_CAPACITYLENS_API` now only
  *overrides* the backend origin rather than switching the server on, and an empty value means
  "same-origin", not "localStorage". The in-browser localStorage app is demoted to an explicit
  opt-in.
- **`npm run dev` is now full-stack.** It boots the SQLite API (`:8787`) and the web app
  (`:5173`) together through a dev proxy, and requires **Node 24** (`node:sqlite`).
  `npm run dev:web` is the previous Vite-only, server-mode command.
- **Docker / Compose default to a portable same-origin server build.** An empty
  `VITE_CAPACITYLENS_API` now builds an image that works on any host with no per-host rebuild
  (nginx proxies `/api` same-origin); the demo image is built with `VITE_CAPACITYLENS_DEMO=1`.

### Added
- **`VITE_CAPACITYLENS_DEMO=1` demo build** — the only route to the zero-setup, no-backend,
  no-login in-browser localStorage app (the old default). It wins over `VITE_CAPACITYLENS_API`
  when both are set. A build served without a same-origin `/api` backend (a static host,
  `vite preview`) must use this flag, or it boots into a "can't reach the server" state.
- **`npm run dev:demo`** — a Vite-only localStorage preview (no server, no Node 24) for a
  zero-setup look at the app.

## [0.10.2] — 2026-06-25

The Time off list reads at a glance — who's away, from when, and for how long.

### Changed
- **Time-off list rows are terser.** Each row now reads the resource, a readable start date
  and a day count (e.g. **Wed 10th Jun · 3 days**) in place of the raw `start → end` range,
  type and note. Those details are still stored and still shown on the schedule's time-off
  block — where the kind of absence and its exact span earn their place — so the list stays a
  quick "who's out" scan.

## [0.10.1] — 2026-06-25

The list-management screens get a lighter touch: row actions become icons, and every "Add" button shows a +.

### Changed
- **Edit and Delete on list rows are now icon buttons.** Each row across Resources, Clients,
  Projects, Disciplines, Activities, Time off (and the company picker) shows a **pencil** for Edit
  and a **trash** for Delete in place of the text buttons — quieter rows, same actions, with the
  label on hover. The confirmation dialogs keep their worded **Delete** / **Cancel** buttons.
- **Every "Add" button leads with a `+`.** The create buttons across the app — Add resource, Add
  client, New company, and the rest — now carry a leading plus, matching the schedule's existing
  per-row add control.

## [0.10.0] — 2026-06-25

New companies start lean, and the view settings that were once browser-wide now belong to each company.

### Changed
- **Placeholders and External are per-company.** They used to be a single switch shared across
  every company on the browser; now each company has its own, toggled in **Settings** (like
  Disciplines). Turning them on in one company no longer turns them on everywhere. Both stay
  **off by default**, and toggling only hides or shows — your placeholder and external data is
  untouched. As a result these settings now travel with **Export JSON**.
- **New companies open minimal.** A brand-new company now starts with **Disciplines off**,
  **scheduling set to Days**, and **Placeholders and External hidden**, so you opt into each
  feature as you need it. Existing companies keep their current settings.

## [0.9.1] — 2026-06-24

Weekends stop counting against capacity unless you opt an allocation into them.

### Fixed
- **A weekend a booking merely spans no longer reads as "over capacity".** An
  allocation that runs across a Saturday/Sunday (or any of a resource's non-working
  days) used to paint those days red, as if the person were overbooked. The work
  lands on working days, so the weekend now just shows as unavailable — not red.
  Ticking **"Include weekends as working days"** on an allocation still counts its
  weekend work (and flags it red against a weekday-only person's zero weekend
  capacity), and work scheduled on a **time-off / holiday** day is still flagged as
  the real conflict it is. The allocation editor's "over capacity on N days"
  advisory now agrees with what the schedule shows.

### Changed
- **Faster over-capacity repaint (internal).** The per-day over-marker no longer
  re-derives a date's weekday once per allocation, keeping timeline zoom/pan smooth
  for heavily-booked resources. No behaviour change.

## [0.9.0] — 2026-06-23

Correctness and integrity hardening from a deep code review, plus a smoother
Time-off draw mode.

### Fixed
- **Days-mode allocations never silently lose work.** Entering an allocation by
  "days of work" with the "Days over" field left blank no longer saves a silent
  0-hour allocation — it asks you to complete the field. And dragging or
  keyboard-resizing a days-mode allocation small enough to exceed a real working
  day now tells you the work volume was capped instead of quietly truncating it.
- **External / 3rd-party resources stay capacity-free, everywhere.** You can no
  longer turn a resource that already has work or time off into an external one
  (which would silently hide that work on the schedule). And editing an
  allocation or time-off entry that points at an external resource is now rejected
  consistently — the local-first app and the server agree instead of one accepting
  what the other rejects.

### Changed
- **Switching Time-off draw mode is smoother.** Toggling the schedule's draw mode
  no longer re-renders every allocation bar.
- **Write-boundary integrity hardening (internal).** A batch of code-review
  cleanups with no user-facing behaviour change: the "external resources carry no
  load" rule is now enforced unconditionally at the type level; import resolves
  each record once; draw-mode styling keys off semantic classes rather than test
  ids; and the built-in Internal client's single-instance contract is documented
  across the three write paths that enforce it.

## [0.8.1] — 2026-06-23

Clearer time-off planning, and tighter guards on bad data.

### Added
- **Time-off draw mode now shows you the landscape.** When you switch the schedule toggle to
  **Time off**, booked allocations recede and existing time-off blocks glow amber — so you can
  see who's already away at a glance before drawing a new absence. (The toggle previously only
  changed its own pressed state.)

### Fixed
- **Days-mode work volume is never silently trimmed.** When you enter an allocation as "days of
  work" over a span, a volume that would exceed a real working day now asks you to spread it over
  more days, instead of quietly capping it at 24h/day and losing the rest.
- **External / 3rd-party resources stay capacity-free everywhere.** They can no longer be given
  working hours or time off through import or the API — matching what the forms already enforced —
  so bad data can't slip in and then render invisibly on the schedule.
- **The built-in "Internal" client stays a single per-account anchor**, even on direct API writes,
  so it can't be accidentally duplicated.

## [0.8.0] — 2026-06-20

Clearer capacity at a glance, and a tidier home for non-client work.

### Added
- **A built-in "Internal" home for non-client work.** Activities that don't belong to a
  client project (internal admin, reusable activities) now group under a built-in
  **Internal** client on the schedule and in filters — so you can book project-less work
  without inventing a fake client. Internal is a behind-the-scenes anchor: it's selectable
  when you assign work and you can file projects under it, but it doesn't clutter your
  Clients list.
- **Over-capacity days turn red.** Any day where someone is booked beyond their capacity
  (strictly over — exactly at capacity is fine) now gets a clear red background, so overload
  jumps out at a glance.
- **A short "What Floaty is" welcome.** A minimal post-login page frames Floaty as a
  resourcing tool — who's busy, who's free — not a project manager. (Placeholder copy for now.)
- **Clear local storage (Settings).** A new destructive action wipes Floaty's browser-stored
  data and preferences after a confirmation — handy for resetting a device. On the hosted
  site your data lives in the database and reloads from there.

### Changed
- **"Tasks" are now "Activities"** throughout the UI, routes, types, API fields, and database.
  Existing local data and JSON exports/imports migrate automatically (in-place schema
  migration; server tables renamed in place).
- **Utilisation % now follows the weeks you're viewing.** The per-person and overall
  utilisation figures are computed over the visible window and recalculate when you switch the
  1/2/4/8-week range, so the number always matches what's on screen. (The "overbooked soon"
  red flag still watches a fixed forward window.)
- **Placeholders are now opt-in.** Unfilled-slot placeholders are off by default and enabled in
  Settings; when on they show with a "?" avatar and a "Placeholder" name. Existing placeholder
  data is hidden, not lost, when off.
- **External / 3rd parties moved into the Resources tab** and are opt-in (off by default,
  enabled in Settings), with a short explainer of what External is and isn't. The old
  `/external` page redirects to Resources.

## [0.7.0] — 2026-06-20

See who's doing what kind of work, across every project.

### Added
- **Task kinds — Project, Internal, and Repeatable.** Every task now has a kind. *Project* tasks
  belong to a project (as before); *Internal* tasks are your own non-client work (admin, internal
  reviews); and *Repeatable* tasks are reusable across many projects (Design, Workshop, Meeting).
  The Tasks page groups them into three sections, and the Add/Edit task form lets you pick the kind —
  a project is required only for *Project* tasks.
- **Filter the schedule by task.** A new **Filter by task** dropdown gives you a "task view" of the
  schedule — see all of a repeatable or internal task's work (e.g. *all design*, *all internal time*)
  across every project at once. It's a standalone lens: picking a task clears the client/project
  filter and vice-versa, so you're always looking through exactly one.

### Changed
- **"General tasks" are now "Repeatable tasks".** Existing project-less tasks become *Repeatable* on
  upgrade — your data migrates in place. Reclassify any that are really *Internal* via the task form.

## [0.6.0] — 2026-06-19

Track outsourced work without managing it.

### Added
- **External / 3rd-party resources.** A new resource type for work you've outsourced to another
  company — managed on a dedicated **External** tab, separate from your own people. Book an external
  party onto any task as a simple **start–end span**: no hours, no capacity, no utilisation (you
  don't track their time, just that the work is with them). They render in their own neutral band
  pinned to the **bottom** of the schedule and are left out of utilisation figures, over-allocation
  markers, and time off. Their booking dialog drops the hours and weekend fields, since weekends are
  just plain calendar days for them.

## [0.5.0] — 2026-06-16

A cosmetic preview of the planned sign-in step.

### Added
- **Demo sign-in screen.** A Google-style *"Choose an account"* screen now appears before the
  company picker in the default deploy, to preview the intended "sign in, then pick a company"
  flow. It is **not** real authentication — there's no password and no popup; clicking the
  account just continues. You stay "signed in" across reloads, with **Sign out** on the picker
  and in the sidebar to return to it. It never appears when the optional real login wall
  (`CAPACITYLENS_AUTH`, formerly `FLOATY_AUTH`) is enabled.

## [0.4.0] — 2026-06-16

Cross-browser end-to-end test coverage.

### Added
- **Firefox/Gecko E2E coverage.** `npm run e2e:firefox` runs the core specs on Firefox
  (mirroring the existing Safari/WebKit twin), and the new **`npm run e2e:browsers`** runs them
  on all three engines — Chromium + WebKit, then Firefox. Both stay opt-in, so Chromium remains
  the default `npm run e2e` inner loop, and the multi-engine runs need only Vite (no SQLite/auth
  server, no Node 24). Firefox always runs after WebKit and unconditionally; a run fails if any
  engine fails. `npm run e2e:all` now adds Firefox on top of its WebKit + server-backed coverage.

## [0.3.0] — 2026-06-16

A new display feature plus the scheduler-geometry work behind it.

### Added
- **Minimise weekends** (Settings → **Schedule**, on by default, per-browser). Shrinks the
  Saturday and Sunday columns to a sliver — just wide enough for the date number, labelled a
  single **"S"** — so the working week dominates the schedule. Weekends aren't removed:
  weekend work and bars that span a weekend still render across the narrowed columns, and a
  drag across a weekend lands on the right date. Turn it off for full-width Sat/Sun columns.

### Changed
- **The schedule fills the viewport more tightly at each zoom.** A "1-week" view now shows
  ~1 week and "2 weeks" ~2 weeks, accounting for the narrowed weekend columns; day columns
  can also grow wider on larger screens (the maximum column width was raised) so a one-week
  view fills the space instead of leaving slack on the right.

### Fixed
- **The left-edge date no longer drifts when you change zoom.** Switching zoom levels used to
  nudge the visible start date back a day onto the weekend; the timeline now holds the same
  date across zoom changes.

## [0.2.0] — 2026-06-16

An Alpha-feedback round: four scheduler / sidebar refinements.

### Added
- **Disciplines are now optional.** A per-company setting (Settings → **Disciplines →
  Use disciplines**, on by default). Turn it off and disciplines disappear from the
  whole app — the sidebar nav item and the `/disciplines` route, the Discipline field
  in the resource form, the schedule's discipline grouping **and** filter, the
  Resources list, the command palette, and the "Show Discipline Utilisation" toggle —
  with the schedule rendering as one flat list. The setting lives on the account, so it
  applies to everyone on that company; your discipline data is preserved and returns if
  you switch it back on.

### Changed
- **The month label stays visible while scrolling.** The month (e.g. "Jun 2026") now
  sticks to the left edge of the timeline as you move across it, instead of scrolling
  away with the 1st of the month.
- **Resource names stay at the top of their row.** On a tall row with several stacked
  allocations, the person's name and avatar stay pinned to the top (aligned with the
  first allocation) rather than drifting to the vertical centre as the row grows.
- **The company / "Switch company" block moved to the bottom of the sidebar.** This
  keeps the logo and collapse toggle as the first item in both the open menu and the
  collapsed icon rail, so the nav icons don't jump when the sidebar collapses.

### Fixed
- **Collapsed (mobile) sidebar alignment & polish.** The collapse toggle and the nav
  icons now share the same left column and the same row height in both the open menu
  and the collapsed rail, so nothing shifts horizontally or vertically when you collapse
  it. Disciplines are correctly hidden from the collapsed rail when turned off, and each
  rail icon now shows an instant hover tooltip of its section name.

## [0.1.0]

- Initial local-first, multi-tenant resource scheduler: week-grid schedule with
  drag/resize allocations, capacity & utilisation cues, time off, the CRUD pages
  (resources, disciplines, clients, projects, tasks), import/export, light/dark themes,
  the command palette, and an optional SQLite-backed server behind the persistence seam.

[0.4.0]: https://github.com/Kevinjohn/floaty-v1/releases/tag/v0.4.0
[0.3.0]: https://github.com/Kevinjohn/floaty-v1/releases/tag/v0.3.0
[0.2.0]: https://github.com/Kevinjohn/floaty-v1/releases/tag/v0.2.0
