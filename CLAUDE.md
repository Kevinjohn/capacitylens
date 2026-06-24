# Floaty — working notes for Claude

# What this Project is
A  **Float-style agency resource scheduler** in the browser (People/Resources →
Allocations across Clients → Projects → Activities, multi-tenant by Account). **Deliberately small
(owner):** one problem — a helicopter view of who's busy/free/overworked, week granularity —
for small agencies with rotating freelancers. Budgets/money, timesheets, hour-granularity
workflows and mobile views are non-goals; don't propose them. This is the **original**
floaty repo; `../floaty-schedule` (shift rota) and `../delivery-diary` (deliverables tracker)
re-target this same setup to new domains. No backend or login by default; an **optional**
SQLite-backed API plugs in behind the persistence seam.

## Architecture in one breath
`shared/` (`@floaty/shared`) = pure domain core (types, validation, integrity, cascade,
import-remap, migrate, seed), imported by both app and server so they can't drift.
`src/store/useStore.ts` (Zustand) = the orchestrator (owns ids/timestamps, undo/redo);
`src/components/scheduler/` builds the week-grid view-model (unit-tested). Persistence is
local-first behind `PersistenceAdapter` (`localStorage` key `floaty/v3`); the optional Node +
`node:sqlite` `server/` drops in behind that seam when `VITE_FLOATY_API` is set. Scoped access
goes through the `useScopedData` / `scopedTables()` seam.

## Load-bearing invariants (don't break)
- **Multi-tenant by Account.** Every entity carries `accountId`; `activeAccountId` is picked on
  load and **never persisted**. Route scoped reads through `useScopedData` / `scopedTables()`.
- **Three distinct over/utilisation signals, kept separate.** (1) The per-day **over-marker** flags
  any day where `allocated > available` (the over / red-background signal — STRICTLY greater, so
  at-capacity is NOT over), whole timeline. `allocated` is **weekend-aware**: a normal allocation does
  no work on the resource's non-working weekdays, so a weekend a bar merely **spans** is NOT over (it
  keeps only the grey "unavailable" tint). The zero-capacity days that DO read as over are a **time-off**
  day a working allocation covers (a real conflict) and a weekend an allocation opts into via
  `ignoreWeekends`. It renders as a clear, saturated red background (`bg-danger-cell` — empty cell, no
  text, so no AA bound) per over-day. (2) The displayed **utilisation %** (per-person,
  per-discipline avg, overall) is a working-day ratio over the currently **VISIBLE window** (the
  1/2/4/8-week zoom span anchored at the scroll left-edge: `[L, L + zoom*7 - 1]`, inclusive end,
  clamped to the timeline; recomputed day-quantized on zoom/pan, not per scroll pixel). (3) The
  `overSoon` red flag stays a working-day ratio over a **fixed forward 14-day window from today**
  (`UTILIZATION_WINDOW_DAYS`), zoom/pan-independent. Different questions — don't merge them.
- **"Utilisation" is the term** everywhere on the schedule, never "Load".
- **Activities carry a required `kind`** (`project` | `internal` | `repeatable`); only `project` has a
  projectId/phase (coherence enforced in `assertScopedRefs`, repaired on import/migrate). The
  domain concept "Task" was renamed "Activity" (schema v5): `Activity` type, `ActivityKind`,
  `Allocation.activityId`, the `activities` table/array; legacy `tasks`/`taskId` data is migrated
  on load/import. "Repeatable" *is* the renamed "general" activity. The schedule's **activity lens**
  ("Filter by activity") is a standalone view, mutually exclusive with the client/project filter
  (set in `setFilters`).
- **Theme is device-global** (own key `floaty/theme`, default light), NOT in `AppData`/export;
  same for utilisation display toggles (`floaty/utilizationPrefs`).
- **Colours are preset swatches only** (no custom hex), and a resource's colour derives from its
  discipline — no per-resource colour control.
- **Forms reject; import + server strip/repair.** Non-Floaty JSON is shape-checked
  (`looksLikeFloaty`) before migrate so it can't wipe data; import is confirmed + undoable, with
  caps on file size + record count.
- **Surface, never swallow.** A `catch` exists only to re-throw with more context, route the error
  to a visible surface (`FieldError`/`Toast`/`setNotice`/typed `LoadError`/503), or degrade to a
  documented default for *non-tenant device prefs only*. No `catch {}` on a data path; never wrap a
  pure function, a hot render path, or the store's deliberate integrity throws (that hides
  corruption — the anti-goal). Full standard in **`DEFENSIVE-CODING.md`** — follow it on every change.
- **Entity/field extension is drift-proofed.** New fields flow shared types → full fixtures
  (`shared/src/data/fixtures.ts`) → `server/src/tables.ts` columns (auto ALTER) → sanitize;
  exhaustiveness checks make a missed list fail the gate. Don't bypass the path.

## Docs map (so you don't read everything to find the right place)
- **`DECISIONS.md`** — slim, present-tense digest of standing decisions. Read it whole; it's
  short. Edit a line here only when a *load-bearing* call actually changes.
- **`DEFENSIVE-CODING.md`** — the defensive-coding & commenting standard (surface-not-swallow, the
  two-tier error model, where `try/catch` belongs vs is harmful, the TSDoc/why-comment bar). Short;
  read it whole and follow it on every change.
- **`NEEDS-INPUT.md`** — open product questions. Flag, don't silently resolve.
- **`docs/decisions-log.md`** — append-only history of dated review/remediation rounds.
  **Don't read it whole** (it's large) — grep it, or read the tail to append.
- **`CODE_REVIEW.md`** — findings from the big review passes (referenced by the log).
- **`user-stories/`** — manual test scripts, 1:1 with the Playwright E2E specs.
  `user-stories/REFERENCE.md` is their single source of truth (routes / labels / `data-testid`s
  / seed data) — update it **first** when the app changes, then the affected stories.
- **`README.md`, `server/README.md`** — stable orientation; touch rarely.

## Logging a decision (keep it cheap)
1. **Append** to `docs/decisions-log.md` as one line + commit ref —
   `- 2026-06-02 — <area> — <what changed> (<sha>)`. Full rationale only for load-bearing calls.
2. **Append by reading the file tail** (`Read` with `offset` near EOF), never the whole file —
   that locality is the whole point of the split.
3. If the call constrains future work, **promote it to `DECISIONS.md`** (one line). When a
   promoted call later changes, edit that line so the digest never drifts from the code.

## Green gate
`npm run gate` (= `tsc -b` + `eslint .` + `vitest run` + `vite build`) **and** `npm run e2e`
(Playwright), all green. Screenshots are the visual oracle; `@axe-core/playwright` (light + dark +
a modal) is the a11y oracle. The `server/` workspace is OUT of the root gate (it needs Node's
`node:sqlite`, Node 24+ per `.nvmrc`); run it separately with `npm run gate:server`.
`npm run e2e` is Chromium; **Safari/WebKit and Firefox/Gecko are opt-in** — `npm run e2e:webkit` /
`npm run e2e:firefox` re-run the core specs on a single engine, `npm run e2e:browsers` runs them on
all three (Chromium + WebKit, then Firefox; Vite-only, so no SQLite/auth server and no Node 24), and
`npm run e2e:all` is the superset that adds the Chromium-only db/auth server specs (so it needs the
servers + Node 24). Both multi-engine runs sequence WebKit→Firefox (both always run, fail if either
does) via `scripts/e2e-{browsers,all}.mjs`. Keep specs browser-agnostic — no UA branching.
