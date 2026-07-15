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
Both gates also run the cryptographic implementation-path discovery check; a new primitive,
certificate/key path or TLS configuration must be reviewed into `docs/security/crypto-inventory.json`.

The mutation configuration deliberately measures the pure shared/scheduler/browser helper layer;
it is not evidence for the Fastify/Better Auth implementation, which is covered by the separate
server integration gate. Review surviving, timed-out and uncovered mutants rather than accepting
the aggregate score alone. The latest triage is recorded in
[`docs/security/mutation-review-2026-07-15.md`](security/mutation-review-2026-07-15.md).

Cross-browser commands:

```bash
pnpm run e2e:webkit
pnpm run e2e:firefox
pnpm run e2e:browsers
pnpm run e2e:all
```

Keep specs browser-agnostic. Screenshots and axe checks are the visual/accessibility oracles.
`e2e:all` runs Chromium plus the server-backed projects first, then WebKit and Firefox in isolated
Vite-only invocations; all three phases run even when an earlier phase fails.

CapacityLens supports current evergreen Chromium, Firefox and WebKit/Safari behavior represented by
the pinned Playwright release. The security baseline assumes HTTPS, Secure/HttpOnly/SameSite
cookies, CSP/frame enforcement, Fetch Metadata or Origin on unsafe cross-site browser requests, and
Web Crypto for encrypted offline access. Online mode remains usable when Web Crypto is unavailable,
but offline snapshot creation fails visibly instead of falling back to plaintext. Obsolete/plugin
browsers are unsupported; the application does not weaken headers or crypto for them.

## GitHub Actions policy

During pre-launch development the repository is private and local checks are the source of truth.
Push, pull-request and scheduled workflow events may appear in GitHub as **skipped**, but they do
not start a hosted runner. This prevents small development pushes and Dependabot pull requests
from repeatedly consuming the private-repository Actions allowance.

Run the complete remote gate deliberately from **GitHub → Actions → gate → Run workflow**, or:

```bash
gh workflow run gate.yml --ref main
```

A manual gate runs the code gates and production dependency audit. Cross-browser E2E and Docker
Compose smoke tests are separate workflows so their README badges report independent status. The gate also
uploads `coverage/lcov.info` to Codecov when the repository has a `CODECOV_TOKEN` secret. CodeQL and
Scorecard remain skipped while the repository is private because their public result services are not
enabled for this repository.

When the repository becomes public, the workflow conditions automatically restore:

- code gates for pull requests, pushes to `main`, release tags and the monthly canary;
- Chromium, Firefox and WebKit E2E for pull requests, pushes to `main`, release tags and its monthly canary;
- Docker Compose builds and production smoke tests for pull requests, pushes to `main` and release
  tags;
- CodeQL for pull requests, `main` and its weekly schedule.
- OpenSSF Scorecard for `main` and its weekly schedule.
- full-history secret scanning, dependency review, source SBOM, container vulnerability scanning,
  OWASP ZAP baseline and tagged release provenance through `security.yml`.

The security workflow remains manually runnable while private and becomes automatic on its
documented public-repository events. See `docs/security/security-review-2026-07-14.md` for the
assessment scope and residual controls.

The coverage badge needs a Codecov project and a repository secret named `CODECOV_TOKEN`; uploads
are deliberately skipped until that secret exists. Scorecard needs `publish_results: true` and its
OIDC permission, which are configured in `.github/workflows/scorecard.yml`.

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
