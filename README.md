# CapacityLens

**Who's free next week?**

Every small agency answers that question badly. It lives in someone's head, a colour-coded
spreadsheet, or a group chat at 5pm on a Friday. So work gets promised to people who are already
full, the quiet capacity nobody noticed goes unsold, and the person who was going to be on holiday
finds out about their new project the week before they leave.

CapacityLens is a shared, week-by-week picture of where everyone's time is going — so you can see
who is busy, who has room, and who is about to be buried, and move things around before it becomes
a problem.

<picture>
  <img alt="The CapacityLens schedule: people grouped by discipline, coloured allocation bars across a two-week window, per-person utilisation, an over-capacity day highlighted in red, and a booked holiday." src="docs-src/screenshots/schedule-light.jpg">
</picture>

One screen. People down the side, days across the top, the work in between. Red means someone is
over capacity that day. The percentage next to each name is how full they are across the window
you're looking at.

## Alpha 4

Alpha 4 is the most complete CapacityLens prerelease yet. Company working days now govern capacity
everywhere, bank holidays and shutdowns are recorded as first-class company closures, allocation
hours are four clear day fractions, and the schedule's filters and controls are quicker to drive.
It follows a codebase-wide simplification pass.

[Read the Alpha 4 release notes](https://github.com/Kevinjohn/capacitylens/releases/tag/v0.55.0-alpha.4)
for the user-facing highlights and upgrade notes.

## Try it in two minutes

The demo runs entirely in your browser with sample data. It is fully editable — drag things about,
book time off, break something. Schedule changes stay in memory and reset when you reload; only
device choices such as the cosmetic signed-in state and display preferences stay in your browser.

```bash
corepack enable
pnpm install
pnpm run dev:demo
```

Then open <http://127.0.0.1:5173>, pick a demo account, and you're in.

## What you can do with it

- **See the week ahead** — 1, 2, 4, 6 or 8 weeks at a time, filtered by discipline, client, project
  or activity.
- **Spot trouble early** — daily over-capacity in red, plus a 14-day forward warning for problems
  just off the edge of the screen.
- **Plan work you haven't won yet** — placeholder people for roles you'd need to hire or borrow, and
  external partners who don't count against your capacity.
- **Keep holidays in the picture** — time off sits in the same view as the work, so it stops being a
  surprise.
- **Know how full you really are** — utilisation per person and across the whole visible window.
- **Run it yourself** — your data in your own SQLite file, on your own server, under AGPL-3.0.

## What it deliberately isn't

CapacityLens will not track tasks, tickets, deadlines, budgets or timesheets, and it won't schedule
anyone by the hour. It answers a simpler question — where are your people's hours going, and where
is there room? — and stops there.

If you need Jira, use Jira. This is the thing you look at _before_ you open Jira.

## Who it's for

Agency owners, studio and operations leads, resource planners and project leads: the people who get
asked "can we take this on?" and need a shared, honest answer.

## Run it for real

Node 24 and pnpm are required; the pinned version is in `.nvmrc`.

```bash
nvm use
corepack enable
pnpm install
pnpm run dev
```

That starts the web app on `:5173` and the SQLite API on `:8787`, with sample data loaded.
A fresh production instance starts empty.

For a real deployment with Docker Compose or plain Node 24 — including TLS, backups and
upgrades — follow the [self-hosting guide](docs-src/self-hosting/index.md).

## Sign-in, in short

Password sign-in is the stable self-hosted default, with breached-password screening, optional
required TOTP MFA and user-controlled session revocation. Strict OIDC is first-class; the named
Google, Microsoft and GitHub providers are still experimental. Optional offline access keeps a
read-only snapshot for up to seven days — it never queues or syncs edits, and SQLite stays the
source of truth.

Details: [how sign-in works](docs-src/company-login/index.md) ·
[offline access](docs-src/guide/offline-access.md)

## Documentation

The docs ship with the repository. Open [`docs/index.html`](docs/) straight from a checkout — no
server, no build — or read the Markdown sources under [`docs-src/`](docs-src/) on GitHub.

- [Getting started](docs-src/getting-started/what-is-capacitylens.md) — the two-minute demo, the
  Docker and direct Node installation routes, invites and roles.
- [Using CapacityLens](docs-src/guide/the-schedule.md) — the schedule, people and placeholders,
  projects and allocations, time off and settings.
- [Company login (SSO)](docs-src/company-login/index.md) — connecting your provider and the guided
  password-to-SSO cutover.
- [Self-hosting](docs-src/self-hosting/index.md) — configuration, TLS, backups, monitoring and
  incident response.
- [Security and privacy](docs-src/security/index.md) — posture, stored data and operator
  responsibilities.
- [Glossary](docs-src/reference/glossary.md) — the terms the docs rely on, in plain language.

## Under the hood

React, TypeScript, Vite and Tailwind in the browser; Zustand for UI state and undo/redo; a shared
TypeScript domain in `shared/` for validation, migrations and the scheduling rules; Fastify and
Better Auth over Node's built-in SQLite driver on the server. Vitest, Testing Library, Playwright
and axe keep it honest. Deploy with Docker Compose or plain Node 24.

The browser always talks to the API; only `VITE_CAPACITYLENS_DEMO=1` swaps in the throwaway
in-memory demo adapter.

## Contributing

```bash
pnpm run gate         # formatting, generated i18n, typecheck, lint, coverage and build budget
pnpm run gate:server  # server/shared formatting, typecheck, tests, coverage and architecture checks
pnpm run e2e          # Chromium demo, database and authentication flows
```

Start with [contributing](CONTRIBUTING.md) and the
[development guide](docs-src/reference/development.md#checks) for the enforced coverage and build
numbers, cross-browser checks and CI jobs. Also worth reading: the
[server README](server/README.md), the [standing decisions](DECISIONS.md) behind the product and
architecture, and the [changelog](CHANGELOG.md).

[Governance](GOVERNANCE.md) · [Support](SUPPORT.md) · [Security policy](SECURITY.md) ·
[Security review](docs-src/security/security-review-2026-08-18.md) ·
[ASVS 5.0.0 ledger](docs-src/security/owasp-asvs-5.0.0.md) · [Trademarks](TRADEMARKS.md)

## Licence

CapacityLens is [AGPL-3.0-only](LICENSE). Product names and logos are handled separately in
[TRADEMARKS.md](TRADEMARKS.md).

[![gate](https://github.com/Kevinjohn/capacitylens/actions/workflows/gate.yml/badge.svg)](https://github.com/Kevinjohn/capacitylens/actions/workflows/gate.yml)
[![E2E](https://github.com/Kevinjohn/capacitylens/actions/workflows/e2e.yml/badge.svg?branch=main)](https://github.com/Kevinjohn/capacitylens/actions/workflows/e2e.yml)
[![test coverage](https://codecov.io/gh/Kevinjohn/capacitylens/graph/badge.svg?branch=main)](https://codecov.io/gh/Kevinjohn/capacitylens)
[![CodeQL](https://github.com/Kevinjohn/capacitylens/actions/workflows/codeql.yml/badge.svg)](https://github.com/Kevinjohn/capacitylens/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Kevinjohn/capacitylens/badge)](https://scorecard.dev/viewer/?uri=github.com/Kevinjohn/capacitylens)
[![Docker build](https://github.com/Kevinjohn/capacitylens/actions/workflows/docker.yml/badge.svg?branch=main)](https://github.com/Kevinjohn/capacitylens/actions/workflows/docker.yml)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)](.nvmrc)
[![license: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
