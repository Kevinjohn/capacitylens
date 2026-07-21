# CapacityLens repository guidance

## Product boundary

CapacityLens is a deliberately small, week-granularity agency capacity scheduler. Budgets,
timesheets, hour-by-hour workflows and mobile scheduling are non-goals.

## Architecture

- `shared/` is the pure domain core imported by app and server.
- `src/store/useStore.ts` orchestrates state, ids, timestamps and undo/redo.
- `src/components/scheduler/` builds the week-grid view-model.
- `server/` is the default SQLite API. `VITE_CAPACITYLENS_DEMO=1` selects the temporary in-memory
  demo; it must never persist scheduling data.
- Scoped reads go through `useScopedData` / `scopedTables()`. The server independently authorizes
  every tenant operation from session membership.

## Load-bearing invariants

- Every scoped entity carries `accountId`; `activeAccountId` is never persisted.
- Over-capacity means `allocated > available`, not equal. Ordinary allocations consume only the
  resource's working weekdays unless `ignoreWeekends` is set.
- Visible utilisation uses the currently visible zoom window. `overSoon` uses a fixed forward
  14-day window. Do not merge these signals.
- Use “Utilisation”, never “Load”, in the schedule UI.
- Activity `kind` is required. Only `project` activities may carry `projectId`/`phaseId`.
- Colours come from preset swatches; a person's colour derives from discipline.
- Forms reject invalid input; import/server sanitise and repair. Server imports are atomic.
- Device preferences are not account data. Offline snapshots are opt-in, seven-day and read-only;
  never add queued offline writes.
- Surface errors. No empty catches on a data path. Follow `DEFENSIVE-CODING.md`.
- New fields flow through shared types → full fixtures → server columns → explicit SQLite migration
  → sanitisation. Keep `EXPORT_SCHEMA_VERSION` and `DB_SCHEMA_VERSION` independent; retain every
  shipped migration and released database fixture. Never alter a released migration definition:
  the database ledger validates its name and SHA-256 checksum. Schema-affecting Better Auth upgrades
  also bump `DB_SCHEMA_VERSION`, even when the library owns the DDL.

## Authentication

- Password auth is stable; social/OIDC is experimental.
- Production password mode supports optional required TOTP MFA and defaults to breached-password
  screening; fixed twelve-hour sessions and fresh administrative actions remain mandatory.
- External identities require verified email plus an unused pre-authorised invitation. The first
  SSO identity requires `CAPACITYLENS_SSO_BOOTSTRAP_EMAILS`.
- Password mode may include providers; `sso` mode removes password sign-in.
- Never weaken server authorization because the UI hides an action.
- Password/session reset authority is identity-global: enforce it across every account the target
  can enter, and never render bearer session tokens.

## Frontend conventions

- Browser baseline is "Baseline widely available" as of Q3 2026. The verified matrix is Chromium by
  default, with WebKit/Firefox behind the `CAPACITYLENS_WEBKIT`/`CAPACITYLENS_FIREFOX` flags in
  `playwright.config.ts`. `color-mix(in oklab)`, `:has()`, `@container`, `svh`/`dvh` units,
  `field-sizing` and `text-wrap: balance` are already in use and considered safe. CSS anchor
  positioning (`anchor-name`/`position-anchor`) is not yet Baseline across that matrix; use Radix
  positioning instead.
- Icon-only buttons and simple hover hints use the native `title=` attribute by default. Reserve the
  Radix-based `Tooltip` in `ui/tooltip.tsx` for cases needing styled, delayed, or keyboard-accessible
  rich content (e.g. the collapsed sidebar rail in `AppSidebar`). This split is deliberate.
- `src/components/ui/button.tsx` and `ui/badge.tsx` carry deliberate local extensions over upstream
  shadcn (button: `danger-soft` variant, `xs`/`icon-xs`/`icon-sm`/`icon-lg` sizes, a retinted
  `default` variant onto project ok-strong tokens; badge: AA-tuned `danger`/`warn` variants).
  Re-pulling either via `npx shadcn add` must diff and re-merge, never overwrite.
- Use the z-index tokens in `src/index.css` rather than ad hoc `z-[N]` values for global layers.

## Documentation

- `DECISIONS.md` holds standing decisions.
- `README.md` is public/product-facing; implementation details belong in `docs/development.md`.
- `docs/self-hosting.md`, `docs/runbook.md`, `docs/authentication.md`, `docs/offline.md` and
  `docs/privacy.md` are the operator set.
- Update `user-stories/REFERENCE.md` first for user-visible route, label, test-id or seed changes.
- Add user-visible changes under `CHANGELOG.md` → `Unreleased`.

## Green gate

Run `pnpm run gate`, `pnpm run gate:server` and `pnpm run e2e`. Cross-browser and mutation suites
are documented in `docs/development.md`. Keep E2E specs browser-agnostic.

## GitHub CI policy

- For patch-version-only changes, skip GitHub CI by default.
- For minor-version changes, ask the user whether GitHub CI should be run before proceeding.
- For major-version changes, GitHub CI must be run; do not skip it.
