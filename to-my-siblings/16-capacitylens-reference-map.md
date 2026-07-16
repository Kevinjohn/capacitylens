# 16 — CapacityLens reference map

Use this map when a handbook rule needs a working example. Paths are relative to the repository
root. Read the implementation and nearest tests together.

## Repository policy

| Pattern | Authority |
| --- | --- |
| Internal handbook/reference snapshots | `to-my-siblings/`, `to-my-siblings/reference-kit/` |
| Optional internal generator | `to-my-siblings/reference-kit/scripts/create-sibling.mjs` |
| Agent-sized constraints | `AGENTS.md` |
| Standing product/architecture decisions | `DECISIONS.md` |
| Error/comment review standard | `DEFENSIVE-CODING.md` |
| Public product boundary | `README.md` |
| Exact visible contract | `user-stories/REFERENCE.md` |
| Story/test index | `user-stories/README.md` |
| Contributor workflow | `docs/development.md`, `CONTRIBUTING.md` |
| Recent behaviour/reasoning | `CHANGELOG.md` |

## Brand and design system

| Pattern | Implementation | Evidence |
| --- | --- | --- |
| Single brand constant/storage prefix | `shared/src/brand.ts` | imports across client/server |
| Semantic light/dark tokens | `src/index.css` | `src/lib/color.test.ts`, `e2e/a11y.spec.ts` |
| Theme preference/resolution | `src/lib/theme.ts`, `public/theme-init.js` | `src/lib/theme.test.ts` |
| Preset palette/contrast | `shared/src/lib/color.ts` | corresponding tests, `e2e/palette.spec.ts` |
| Product component kit | `src/components/common/` | `src/components/common/ui.test.tsx` |
| shadcn primitive boundary | `src/components/ui/`, `components.json` | build/lint/component tests |
| Typed messages/i18n seam | `messages/en.json`, `src/i18n/`, `vite.config.ts` | `src/i18n/i18n.test.tsx` |

## Shell, navigation and onboarding

| Pattern | Implementation | Evidence |
| --- | --- | --- |
| Gate order/sidebar/toasts/shortcuts | `src/components/AppShell.tsx` | `src/components/AppShell.test.tsx`, `e2e/navigation.spec.ts` |
| Single nav definition | `src/lib/navLinks.ts` | navigation/command tests |
| Lazy routing and special routes | `src/router.tsx` | invite/reset/navigation E2E |
| Command palette | `src/components/CommandPalette.tsx` | component test and `e2e/navigation.spec.ts` |
| Tenant picker/create flow | `src/components/accounts/AccountPicker.tsx` | component, onboarding DB/E2E |
| Cosmetic demo sign-in | `src/components/FakeSignIn.tsx`, `src/lib/fakeAuth.ts` | `e2e/fake-signin.spec.ts` |
| Product intro | `src/components/IntroPage.tsx`, `src/lib/introCopy.ts` | intro/fake-sign-in/login tests |
| State-derived checklist | `src/components/GettingStarted.tsx`, `src/lib/gettingStarted.ts` | unit + `e2e/getting-started.spec.ts` |
| Loose tour | `src/lib/tour.ts` | getting-started E2E |
| Portrait phone hint | `src/components/RotateHint.tsx` | component + `e2e/mobile.spec.ts` |

## Domain, tenancy and lifecycle

| Pattern | Implementation | Evidence |
| --- | --- | --- |
| Entity envelope + canonical entities | `shared/src/types/entities.ts` | fixtures and typecheck |
| Scoped table/read projections | `shared/src/domain/tenancy.ts`, `src/store/useScopedData.ts` | multitenancy/tenancy tests |
| Domain write enforcement | `shared/src/domain/mutations.ts` | `shared/src/domain/mutations.test.ts` |
| Lifecycle machine | `shared/src/domain/lifecycle.ts` | lifecycle tests, server lifecycle tests, archived E2E |
| Built-in Internal record | `shared/src/data/internalClient.ts` | internal-client tests/E2E |
| Private name projection | `shared/src/domain/privateNames.ts` | private-name/authz/tenant-store tests |
| Portable export migrations | `shared/src/data/migrate.ts` | migrate tests |
| Import sanitisation | `shared/src/lib/sanitizeImport.ts` | sanitise/import-hardening tests |
| Transfer/export | `shared/src/data/transfer.ts` | transfer/import-export tests |
| Full fictional fixtures/seed | `shared/src/data/fixtures.ts`, `shared/src/data/seed.ts`, `src/test/fixtures.ts` | E2E seed reference |

## Auth and permissions

| Pattern | Implementation | Evidence |
| --- | --- | --- |
| Role/action matrix/interlocks | `shared/src/domain/access.ts` | `shared/src/domain/access.test.ts` |
| Better Auth/env validation | `server/src/auth.ts` | auth/app-auth tests |
| Password hash/breach policy | `server/src/passwordSecurity.ts` | `server/src/passwordSecurity.test.ts` |
| MFA enrollment/challenge | `src/auth/MfaEnrollmentScreen.tsx`, `src/auth/LoginScreen.tsx` | component/auth tests, login auth E2E |
| Fixed/fresh session policy | `server/src/auth.ts`, `server/src/app.ts` | auth/member tests |
| User/member session revocation | `src/components/settings/SecuritySection.tsx`, `server/src/app.ts` | SecuritySection/member tests |
| Auth provider boundary | `server/src/authAdapter.ts`, `src/auth/AuthProvider.tsx` | corresponding tests |
| Login/first owner | `src/auth/LoginScreen.tsx` | login/app-auth tests |
| Browser permission fail-closed | `src/auth/PermissionProvider.tsx`, `src/auth/permissionContext.ts` | permission tests, viewer E2E |
| Membership/invites/reset control data | `server/src/controlTables.ts`, `server/src/membership.ts` | control/membership/invite/reset tests |
| Route authorization | `server/src/app.ts` `authorize` seam | `server/src/app.authz.test.ts` |
| Invite acceptance | `src/components/invites/InviteAccept.tsx` | `e2e/invite.auth.spec.ts` |
| Members UI | `src/components/settings/MembersSection.tsx` | component + members auth E2E |
| Password reset page | `src/auth/ResetPassword.tsx` | component + reset auth E2E |

## State and persistence

| Pattern | Implementation | Evidence |
| --- | --- | --- |
| Store/history/mutations | `src/store/useStore.ts` | store CRUD/lifecycle/undo/tenancy tests |
| Persistence adapter contract | `src/data/PersistenceAdapter.ts` | adapter tests |
| Explicit in-memory demo | `src/data/InMemoryDemoAdapter.ts` | smoke/persistence tests |
| Server diff/batch adapter | `src/data/ServerSyncAdapter.ts`, `src/data/syncOps.ts` | server-sync tests |
| Debounce/retry/refresh/suspension | `src/data/persist.ts` | persistence/undo-sync tests |
| Request timeouts | `src/data/requestTimeout.ts` | timeout tests |
| Account slice validation | `src/data/validateAccountSlice.ts` | server adapter/import tests |
| Offline snapshot | `src/data/offlineCache.ts`, `src/data/useOfflineState.ts`, `public/offline-worker.js` | offline tests + docs |
| Device data cleanup | `src/data/clearLocalStorage.ts` | cleanup tests/E2E |
| Import/export UI | `src/components/ImportExport.tsx` | component + data E2E |

## Server and storage

| Pattern | Implementation | Evidence |
| --- | --- | --- |
| HTTP boundary/routes | `server/src/app.ts` | `server/src/app*.test.ts` |
| DB open/plan/checksummed ledger/migrate/load | `server/src/db.ts` | `server/src/db.migrate.test.ts`, tenant-store tests |
| Exhaustive SQL columns/order | `server/src/tables.ts` | typecheck/round-trip tests |
| Tenant store/privacy preservation | `server/src/tenantStore.ts` | tenant-store/authz tests |
| Request validation | `server/src/validate.ts` | app/validate tests |
| Transaction helper | `server/src/txn.ts` | batch/import tests |
| Audit | `server/src/audit.ts` | audit tests |
| Online backup | `server/src/backup.ts` | backup/restore drill tests |
| Anonymised migration release rehearsal | `server/scripts/rehearse-migrations.ts` | default v7 fixture and representative legacy-DB rehearsal |
| Production boot guards | `server/src/productionGuard.ts`, `server/src/bootGuard.ts` | guard tests |
| Shutdown/drain | `server/src/shutdown.ts`, `server/src/index.ts` | shutdown tests |

## Deployment and operations

| Pattern | Authority/evidence |
| --- | --- |
| Complete variable register | `.env.example` |
| Compose topology/hardening | `docker-compose.yml`, `Dockerfile` |
| Same-origin proxy/security headers | `nginx.conf` |
| Self-host/upgrade/handoff | `docs/self-hosting.md` |
| Auth operator guide | `docs/authentication.md` |
| Offline contract | `docs/offline.md` |
| Privacy/retention | `docs/privacy.md` |
| Health/backup/incident/restore | `docs/runbook.md` |
| Migration authoring/rehearsal policy | `docs/development.md`, `to-my-siblings/18-database-migrations-and-upgrades.md` |
| Production container smoke | `.github/workflows/docker.yml` |
| Tiered production posture and attestations | `server/src/productionGuard.ts`, `server/src/productionGuard.test.ts` |
| Complete OWASP/security posture | `docs/security/owasp-asvs-5.0.0.md`, `docs/security/security-review-2026-07-14.md`, `docs/security/threat-model.md` |
| Password/security egress disclosure | `docs/authentication.md`, `docs/privacy.md` | password security/privacy tests |

## Quality and delivery

| Pattern | Authority |
| --- | --- |
| Scripts/dependencies/coverage | `package.json`, `vite.config.ts` |
| Strict compiler split | `tsconfig.app.json`, `tsconfig.node.json`, package tsconfigs |
| Lint/promise rules | `eslint.config.js` |
| E2E flavours/browsers | `playwright.config.ts`, `scripts/e2e-*.mjs` |
| Mutation scope | `stryker.config.json` |
| Gate workflow | `.github/workflows/gate.yml` |
| Dedicated E2E/Docker signals | `.github/workflows/e2e.yml`, `docker.yml` |
| CodeQL/Scorecard | `.github/workflows/codeql.yml`, `scorecard.yml` |
| Dependency cadence | `.github/dependabot.yml` |
| PR expectations | `.github/pull_request_template.md` |

## Open-source/SaaS policy

| Pattern | Authority |
| --- | --- |
| AGPL licence | `LICENSE`, package manifests |
| Contribution/DCO | `CONTRIBUTING.md`, gate DCO job |
| Governance/conflict | `GOVERNANCE.md` |
| Community support boundary | `SUPPORT.md` |
| Private vulnerability reporting | `SECURITY.md` |
| Brand/fork boundary | `TRADEMARKS.md` |
| Community conduct | `CODE_OF_CONDUCT.md` |
| Open/hosted standing decision | `DECISIONS.md` |

## Recent hardening baseline

For the changes that motivated this handbook, read:

- `CHANGELOG.md` versions `0.17.0` through `0.20.0-alpha.3`;
- commits around `harden data integrity and persistence`,
  `harden lifecycle and mutation recovery` and `release CapacityLens 0.19.0`;
- exact acceptance additions in `user-stories/navigation/US-NAV-14*`,
  `US-NAV-15*` and `user-stories/privacy/`.

The `0.20.0-alpha.3` deployment fix is the reference for separating non-negotiable application
safety from optional operator infrastructure without hiding the resulting ASVS limitations. Git
history explains why a defensive pattern exists; the current code/tests remain authoritative.
