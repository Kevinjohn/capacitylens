# CapacityLens

**Who's free next week?**

<a href="docs-src/screenshots/demo.mp4">
  <img alt="A 50-second walkthrough of the CapacityLens demo: an over-capacity day shows in red, a tentative booking is dragged to a colleague with room, new work is booked by dragging across two days, the schedule zooms out to four weeks, a client, a project and a person are added, the new person is booked onto the new project, and the Overview shows free days per person for the weeks ahead." src="docs-src/screenshots/demo.gif">
</a>

Every small agency answers that question badly. It lives in someone's head, a colour-coded
spreadsheet, or a group chat at 5pm on a Friday. So work gets promised to people who are already
full, the quiet capacity nobody noticed goes unsold, and the person who was going to be on holiday
finds out about their new project the week before they leave.

CapacityLens puts the answer on one shared screen: people down the side, days across the top, the
work and time off in between. Red means someone is booked for more than they can do that day. See
who is busy, who has room and who is about to be buried, and move work before it becomes a problem.

It is free and open source (AGPL-3.0), with no paid tier and no hosted version. You run it on your
own server, and the only cost is that server
([server size](https://kevinjohn.github.io/capacitylens/self-hosting/install.html#server-size)).

## Get started

**Installing it?** Install it (five short steps, about ten minutes on a host that already runs
Node 24), add HTTPS, check backups and hand over:
[install CapacityLens](https://kevinjohn.github.io/capacitylens/self-hosting/index.html).

**Own the company?** Sign in with the setup token, create the company, invite an Admin:
[set up your company](https://kevinjohn.github.io/capacitylens/owner/index.html).

**Set the work?** Add your people, clients and projects, then book the first work:
[get the schedule ready](https://kevinjohn.github.io/capacitylens/admin/index.html).

**Just want to see your work?** Accept your invitation and your week is on the first screen:
[see your work](https://kevinjohn.github.io/capacitylens/using/index.html).

Doing all of it yourself? [The whole setup on one page](https://kevinjohn.github.io/capacitylens/getting-started/quick-start.html).

## Try it in two minutes

For people comfortable with a terminal: the demo runs on your computer with sample data and no
sign-in, and needs the developer tools Node 24 and git. Drag things about, book time off, break
something: changes reset when you reload. Everyone else: watch the walkthrough above instead.

```bash
corepack enable
pnpm install
pnpm run dev:demo
```

Then open the **Local** address it prints (usually <http://127.0.0.1:5173>), select the sample
sign-in on **Choose an account**, then pick a company on **Choose a company**.

## What you get

- **The weeks ahead at a glance:** 1 to 8 weeks, filtered by discipline, client, project or activity.
- **Early warning:** over-capacity days in red, plus a 14-day warning for trouble off screen.
- **Work you haven't won yet:** tentative bookings, placeholders for roles you haven't filled, and
  external parties who don't count against your capacity.
- **Time off in the same picture:** holidays, closures and each person's start and end dates sit
  beside the work.
- **How full everyone is:** utilisation per person and across the weeks on screen.
- **Server-owned scheduling:** a connection is required; failed requests show an error and retry controls.
- **Your own server:** your data in one SQLite file you control, under AGPL-3.0.

## What it deliberately isn't

CapacityLens does not track tasks, tickets, deadlines, budgets or timesheets, and it doesn't
schedule anyone by the hour. If you need Jira, use Jira. This is the view you check _before_ you
open Jira.

There is no importer from spreadsheets or other tools: you enter your people, clients and projects
in the app, and the JSON import only moves data between CapacityLens installations.

## Install it

CapacityLens is currently supplied as a native Node.js release archive. Follow the
[installation guide](https://kevinjohn.github.io/capacitylens/self-hosting/install.html), then
configure HTTPS at an external reverse proxy. The operator guides cover
[configuration](https://kevinjohn.github.io/capacitylens/self-hosting/configuration.html),
[backups](https://kevinjohn.github.io/capacitylens/self-hosting/backups-and-restore.html),
[upgrades](https://kevinjohn.github.io/capacitylens/self-hosting/upgrades.html) and
[monitoring](https://kevinjohn.github.io/capacitylens/self-hosting/monitoring.html). Docker
deployment uses separate web and API images with a checked upgrade step before startup. Google company sign-in is supported; Microsoft is deferred
and GitHub sign-in is retired. See [company login](https://kevinjohn.github.io/capacitylens/company-login/index.html).

## Documentation

Read the [documentation](https://kevinjohn.github.io/capacitylens/) online, open
[`docs/index.html`](docs/) straight from a checkout with no server or build, or read the Markdown
sources in [`docs-src/`](docs-src/). [What is CapacityLens?](https://kevinjohn.github.io/capacitylens/getting-started/what-is-capacitylens.html)
is the one-page introduction.

## Project status

CapacityLens is alpha software with a single maintainer. Beta will mean the upgrade path and the
settings are stable. Database upgrades are tested from thirteen released database
snapshots, the oldest from 0.20.0-alpha.1, so a database created by that release or any later one
is expected to upgrade in place.
[Before you adopt](https://kevinjohn.github.io/capacitylens/getting-started/what-is-capacitylens.html#before-you-adopt)
covers status, getting your data out and support. See
[how it is tested](docs-src/reference/how-it-is-tested.md) and the
[release notes](https://github.com/Kevinjohn/capacitylens/releases/latest).

## Contributing

React, TypeScript and Vite in the browser; AdonisJS and Lucid over SQLite on the server; a shared
TypeScript domain package for the scheduling rules. Start with [CONTRIBUTING.md](CONTRIBUTING.md)
and the [standing decisions](DECISIONS.md).

[Governance](GOVERNANCE.md) · [Support](SUPPORT.md) · [Security policy](SECURITY.md) ·
[Security review](docs-src/security/reviews/security-review-2026-08-18.md) ·
[ASVS 5.0.0 ledger](docs-src/security/owasp-asvs-5.0.0.md) · [Changelog](CHANGELOG.md) ·
[Trademarks](TRADEMARKS.md)

## Licence

CapacityLens is [AGPL-3.0-only](LICENSE). Product names and logos are handled separately in
[TRADEMARKS.md](TRADEMARKS.md).

[![gate](https://github.com/Kevinjohn/capacitylens/actions/workflows/gate.yml/badge.svg)](https://github.com/Kevinjohn/capacitylens/actions/workflows/gate.yml)
[![E2E](https://github.com/Kevinjohn/capacitylens/actions/workflows/e2e.yml/badge.svg?branch=main)](https://github.com/Kevinjohn/capacitylens/actions/workflows/e2e.yml)
[![test coverage](https://codecov.io/gh/Kevinjohn/capacitylens/graph/badge.svg?branch=main)](https://codecov.io/gh/Kevinjohn/capacitylens)
[![CodeQL](https://github.com/Kevinjohn/capacitylens/actions/workflows/codeql.yml/badge.svg)](https://github.com/Kevinjohn/capacitylens/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Kevinjohn/capacitylens/badge)](https://scorecard.dev/viewer/?uri=github.com/Kevinjohn/capacitylens)
[![OpenSSF Baseline](https://www.bestpractices.dev/projects/14555/baseline)](https://www.bestpractices.dev/projects/14555)
[![Docker build](https://github.com/Kevinjohn/capacitylens/actions/workflows/docker.yml/badge.svg?branch=main)](https://github.com/Kevinjohn/capacitylens/actions/workflows/docker.yml)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)](.nvmrc)
[![license: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
