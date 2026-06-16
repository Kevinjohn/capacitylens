# Changelog

All notable changes to Floaty are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/) — while pre-1.0, **minor** versions carry
new features and **patch** versions carry fixes.

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

[0.3.0]: https://github.com/Kevinjohn/floaty-v1/releases/tag/v0.3.0
[0.2.0]: https://github.com/Kevinjohn/floaty-v1/releases/tag/v0.2.0
