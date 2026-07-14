# CapacityLens

[![gate](https://github.com/Kevinjohn/capacitylens/actions/workflows/gate.yml/badge.svg)](https://github.com/Kevinjohn/capacitylens/actions/workflows/gate.yml)
[![CodeQL](https://github.com/Kevinjohn/capacitylens/actions/workflows/codeql.yml/badge.svg)](https://github.com/Kevinjohn/capacitylens/actions/workflows/codeql.yml)
[![license: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

**A calm, week-by-week view of who is busy, free, or over capacity.**

CapacityLens is a deliberately focused resource scheduler for small agencies. It keeps people,
clients, projects, activities, allocations and time off in one visual plan without turning into a
timesheet, finance system or project-management suite.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/schedule-dark.png">
  <img alt="CapacityLens schedule showing people, allocation bars, utilisation, time off and an over-capacity day." src="docs/screenshots/schedule-light.png">
</picture>

## What it does

- Plans work in a 1, 2, 4 or 8 week window.
- Separates daily over-capacity, visible-window utilisation and the fixed 14-day warning signal.
- Models clients → projects → activities and people → allocations, with account-level isolation.
- Supports people, placeholders and capacity-free external partners.
- Includes lifecycle management, JSON import/export, undo/redo, keyboard navigation, light/dark
  themes and accessible automated checks.
- Stores the source of truth in one SQLite file, with audit logging and online snapshots.

Budgets, billing, timesheets, hour-by-hour workflows and mobile scheduling are intentional
non-goals.

## Try it without setup

The demo is editable but intentionally temporary: it runs entirely in memory and resets when the
page reloads. It never creates an account or writes scheduling data to browser storage.

```bash
corepack enable
pnpm install
pnpm run dev:demo
```

Open <http://127.0.0.1:5173>. Node 24 is required for the full stack; the current version is pinned
in `.nvmrc`.

## Run the full stack

```bash
nvm use
corepack enable
pnpm install
pnpm run dev
```

This starts the SQLite API on `:8787` and the web app on `:5173`. Development seeds sample data;
a fresh production instance starts empty.

For a self-hosted deployment:

```bash
cp .env.example .env
# Set CAPACITYLENS_AUTH=password, BETTER_AUTH_SECRET, BETTER_AUTH_URL and
# CAPACITYLENS_SETUP_TOKEN before exposing the service.
docker compose up --build -d
```

Read the [self-hosting guide](docs/self-hosting.md) before using it on the public internet.

## Authentication and offline reading

Email/password authentication is the stable default. Google, Microsoft, GitHub and generic OIDC
can be enabled alongside it, but are marked **experimental** until the project has broader
provider interoperability evidence. External identities must provide a verified email and must
match an unused invitation; the first SSO identity must be explicitly allow-listed by the
operator. `CAPACITYLENS_AUTH=sso` removes the password route when an operator is ready for
SSO-only access.

Offline access is a device opt-in. It caches the app shell and the last verified account snapshot
for at most seven days. Offline mode is strictly read-only: no create, update, delete or queued
sync is possible. Sign-out and “Clear device data” remove the cached identity and snapshots.
See [offline access](docs/offline.md) and [authentication](docs/authentication.md).

## Architecture

- `src/` — React, Zustand and the tested scheduler view-model.
- `shared/` — pure types, validation, integrity, migrations and domain rules used by both sides.
- `server/` — Fastify, Better Auth and Node's built-in SQLite driver.

The browser talks through a `PersistenceAdapter`. Normal builds use the API; only
`VITE_CAPACITYLENS_DEMO=1` selects the in-memory adapter. There is no storage fallback if the
server is unavailable.

## Quality bar

```bash
pnpm run gate         # typecheck, lint, coverage-gated tests, production build
pnpm run gate:server  # server/shared typecheck and tests
pnpm run e2e          # Chromium: demo, database and auth flows
```

CI repeats these checks, audits production dependencies, smoke-tests the containers and runs
CodeQL. The larger browser and mutation suites are documented in [development](docs/development.md).

## Project documents

- [Contributing](CONTRIBUTING.md) · [Governance](GOVERNANCE.md) · [Support](SUPPORT.md)
- [Security policy](SECURITY.md) · [Privacy](docs/privacy.md)
- [Self-hosting](docs/self-hosting.md) · [Operations](docs/runbook.md)
- [Standing decisions](DECISIONS.md) · [Changelog](CHANGELOG.md)

## License

CapacityLens is licensed under [AGPL-3.0-only](LICENSE). Network operators of a modified version
must offer the corresponding source to its users. Product names and logos are addressed
separately in [TRADEMARKS.md](TRADEMARKS.md). This licensing posture should receive professional
legal review before a commercial hosted service launches.
