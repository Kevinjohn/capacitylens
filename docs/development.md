# Development

Use Node 24 from `.nvmrc` and pnpm from `packageManager`.

```bash
nvm use
corepack enable
pnpm install
```

## Run modes

```bash
pnpm run dev       # SQLite API :8787 + web :5173, seeded development data
pnpm run dev:demo  # web :5173, editable in-memory data, resets on reload
```

An empty `VITE_CAPACITYLENS_API` means same-origin server mode. A non-empty value overrides the API
origin. Only `VITE_CAPACITYLENS_DEMO=1` selects the in-memory adapter.

## Checks

```bash
pnpm run gate
pnpm run gate:server
pnpm run e2e
pnpm run coverage
pnpm run mutation
```

`gate` compiles translations, type-checks, lints with zero warnings, runs Vitest with enforced
coverage floors and builds the SPA.
The build also enforces a budget on the main JavaScript entry chunk; route-level lazy chunks remain
separate so authentication and settings code do not inflate first load unnoticed.
`gate:server` checks the Node/SQLite workspace. Default E2E runs demo, database-backed and
password-auth flows in Chromium.

Cross-browser commands:

```bash
pnpm run e2e:webkit
pnpm run e2e:firefox
pnpm run e2e:browsers
pnpm run e2e:all
```

Keep specs browser-agnostic. Screenshots and axe checks are the visual/accessibility oracles.

## GitHub Actions policy

During pre-launch development the repository is private and local checks are the source of truth.
Push, pull-request and scheduled workflow events may appear in GitHub as **skipped**, but they do
not start a hosted runner. This prevents small development pushes and Dependabot pull requests
from repeatedly consuming the private-repository Actions allowance.

Run the complete remote gate deliberately from **GitHub → Actions → gate → Run workflow**, or:

```bash
gh workflow run gate.yml --ref main
```

A manual gate runs the code gates, production dependency audit, Chromium E2E suite and Docker
Compose smoke test. CodeQL remains skipped while the repository is private because private code
scanning is not enabled.

When the repository becomes public, the workflow conditions automatically restore:

- code gates and Chromium E2E for pull requests, pushes to `main`, release tags and the monthly
  canary;
- Docker Compose smoke tests for pull requests and manual dispatches;
- CodeQL for pull requests, `main` and its weekly schedule.

Standard GitHub-hosted runners are free for public repositories. Dependabot's monthly npm, GitHub
Actions and Docker updates remain enabled while private; pnpm is updated from `/` because the root
workspace owns the shared lockfile.

## Repository map

- `shared/src/types/entities.ts` — canonical data model.
- `shared/src/domain/` and `shared/src/lib/` — environment-independent rules.
- `src/store/useStore.ts` — client orchestration and history.
- `src/data/` — persistence, in-memory demo and opt-in offline cache.
- `src/components/scheduler/` — grid/view-model.
- `server/src/app.ts` — HTTP boundary and authorization.
- `server/src/tables.ts` — schema/column specification.

Read `AGENTS.md`, `DECISIONS.md` and `DEFENSIVE-CODING.md` before broad changes.

## Test data and generated files

Sample organisations and people must be fictional. Never copy production names, notes, domains or
ids into fixtures, screenshots or stories. Paraglide output, test reports, databases and local
agent configuration are ignored and must not be committed.

## Ports

The complete E2E matrix also uses web/API ports 5273, 5373 and 8887. Stop an existing dev stack
before E2E; Playwright intentionally refuses to reuse the demo/auth servers because persistence
flavour matters.
