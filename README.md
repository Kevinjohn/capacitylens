# CapacityLens

[![gate](https://github.com/Kevinjohn/capacitylens/actions/workflows/gate.yml/badge.svg)](https://github.com/Kevinjohn/capacitylens/actions/workflows/gate.yml)
[![E2E](https://github.com/Kevinjohn/capacitylens/actions/workflows/e2e.yml/badge.svg?branch=main)](https://github.com/Kevinjohn/capacitylens/actions/workflows/e2e.yml)
[![test coverage](https://codecov.io/gh/Kevinjohn/capacitylens/graph/badge.svg?branch=main)](https://codecov.io/gh/Kevinjohn/capacitylens)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)](.nvmrc)
[![CodeQL](https://github.com/Kevinjohn/capacitylens/actions/workflows/codeql.yml/badge.svg)](https://github.com/Kevinjohn/capacitylens/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Kevinjohn/capacitylens/badge)](https://scorecard.dev/viewer/?uri=github.com/Kevinjohn/capacitylens)
[![Docker build](https://github.com/Kevinjohn/capacitylens/actions/workflows/docker.yml/badge.svg?branch=main)](https://github.com/Kevinjohn/capacitylens/actions/workflows/docker.yml)
[![license: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

**Week-by-week capacity planning for small agencies.**

CapacityLens makes it easy to see who is busy, available or over capacity, then adjust the plan
before schedules become problems.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/schedule-dark.png">
  <img alt="CapacityLens schedule showing people, allocation bars, utilisation, time off and an over-capacity day." src="docs/screenshots/schedule-light.png">
</picture>

## What it is

CapacityLens is a deliberately small, self-hosted resource scheduler for agencies that plan work
in weekly blocks.

- Plan clients → projects → activities and people → allocations → time off in one visual schedule.
- View a 1, 2, 4 or 8 week window.
- See daily over-capacity, visible-window **Utilisation**, and a separate 14-day forward warning.
- Include employees, placeholders and capacity-free external partners.
- Keep accounts isolated with role-based access and a SQLite source of truth.
- Import and export JSON, undo and redo changes, and use keyboard-friendly light or dark themes.

## What it is not

CapacityLens is not a:

- budget, billing or financial planning system;
- timesheet or time-tracking tool;
- hour-by-hour scheduling system;
- project-management suite or CRM; or
- mobile-first scheduling app.

Those boundaries are intentional. CapacityLens is for a clear weekly view of resource capacity,
not for managing every part of agency operations.

## Who it is for

Agency owners, studio or operations leads, resource planners and project leads who need a shared
answer to: “Who can take on this work, and when?”

## Try it

The demo is editable but temporary. It runs in memory, resets on reload and never stores schedule
data in browser storage.

```bash
corepack enable
pnpm install
pnpm run dev:demo
```

Open <http://127.0.0.1:5173>.

## Run the full stack

Node 24 and pnpm are required. The pinned Node version is in `.nvmrc`.

```bash
nvm use
corepack enable
pnpm install
pnpm run dev
```

This starts the web app on `:5173` and the SQLite API on `:8787`. Development mode includes sample
data; a fresh production instance starts empty.

For a persistent deployment, start with the [self-hosting guide](docs/self-hosting.md).

## Stack

| Area | Technology | Purpose |
| --- | --- | --- |
| Web app | React, TypeScript, Vite, Tailwind CSS | The schedule and settings UI |
| Client state | Zustand | UI state, persistence orchestration and undo/redo |
| Shared domain | TypeScript in `shared/` | Types, validation, migrations and scheduling rules |
| API and auth | Fastify and Better Auth | HTTP API, sessions and account authorization |
| Database | Node’s built-in SQLite driver | Persistent server-side source of truth |
| Verification | Vitest, Testing Library, Playwright and axe | Unit, integration, browser and accessibility checks |
| Deployment | Docker Compose or Node 24 | Self-hosted production and development environments |

The browser uses the API in normal builds. Only `VITE_CAPACITYLENS_DEMO=1` selects the temporary
in-memory demo adapter.

## Authentication and offline access

- Password authentication is the stable default. Social providers and generic OIDC are experimental.
- Password mode defaults to breached-password screening and supports optional required TOTP MFA,
  with fixed/idle session limits, host-only cookies and user-controlled session revocation.
- Optional offline access stores a verified snapshot for up to seven days.
- Offline mode is read-only: it never queues or synchronises edits.
- The SQLite database remains the source of truth.

Read the details in [authentication](docs/authentication.md) and [offline access](docs/offline.md).

## Checks for contributors

```bash
pnpm run gate         # client typecheck, lint, tests, coverage and production build
pnpm run gate:server  # server/shared typecheck and tests
pnpm run e2e          # Chromium demo, database and authentication flows
```

See [development](docs/development.md) for cross-browser, mutation and GitHub Actions checks.

## Documentation

### Using and operating CapacityLens

- [Self-hosting](docs/self-hosting.md) — Docker Compose, environment variables, upgrades and deployment.
- [Authentication](docs/authentication.md) — password, social and OIDC modes.
- [Offline access](docs/offline.md) — device cache behavior and limitations.
- [Operations runbook](docs/runbook.md) — health checks, backups, restore drills and incidents.
- [Privacy](docs/privacy.md) — stored data, browser storage and operator responsibilities.

### Developing CapacityLens

- [Development guide](docs/development.md) — repository map, checks, test data and local workflows.
- [Server README](server/README.md) — API, authorization, persistence and backup boundaries.
- [Security review](docs/security/security-review-2026-07-14.md) — threat model, remediations,
  residual risks and complete OWASP mappings.
- [ASVS 5.0.0 ledger](docs/security/owasp-asvs-5.0.0.md) — every L1–L3 requirement accounted for.
- [Standing decisions](DECISIONS.md) — decisions that shape the product and architecture.
- [Changelog](CHANGELOG.md) — released and upcoming changes.

### Project policies

[Contributing](CONTRIBUTING.md) · [Governance](GOVERNANCE.md) · [Support](SUPPORT.md) ·
[Security policy](SECURITY.md) · [Trademarks](TRADEMARKS.md)

## License

CapacityLens is licensed under [AGPL-3.0-only](LICENSE). Product names and logos are addressed
separately in [TRADEMARKS.md](TRADEMARKS.md).
