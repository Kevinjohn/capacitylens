# Floaty — working notes for Claude

Keep this file short — it loads every session.

## What this is
A local-first **Float-style agency resource scheduler** in the browser (People/Resources →
Allocations across Clients → Projects → Tasks, multi-tenant by Account). This is the **original**
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
- **Two distinct "over" signals, kept separate.** The per-day over-marker flags any work on a
  zero-capacity day; utilisation % / `overSoon` is a working-day ratio over a fixed forward 14-day
  window from today. Different questions — don't merge them.
- **"Utilisation" is the term** everywhere on the schedule, never "Load".
- **Theme is device-global** (own key `floaty/theme`, default light), NOT in `AppData`/export;
  same for utilisation display toggles (`floaty/utilizationPrefs`).
- **Colours are preset swatches only** (no custom hex), and a resource's colour derives from its
  discipline — no per-resource colour control.
- **Forms reject; import + server strip/repair.** Non-Floaty JSON is shape-checked
  (`looksLikeFloaty`) before migrate so it can't wipe data; import is confirmed + undoable, with
  caps on file size + record count.

## Docs map (so you don't read everything to find the right place)
- **`DECISIONS.md`** — slim, present-tense digest of standing decisions. Read it whole; it's
  short. Edit a line here only when a *load-bearing* call actually changes.
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
a modal) is the a11y oracle. The `server/` workspace is OUT of the root gate (it needs
`--experimental-sqlite`); run it separately with `npm run gate:server`.
