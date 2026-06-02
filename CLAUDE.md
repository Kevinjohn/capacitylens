# Floaty — working notes for Claude

Keep this file short — it loads every session.

## Docs map (so you don't read everything to find the right place)
- **`DECISIONS.md`** — slim, present-tense digest of standing decisions. Read it whole; it's
  short. Edit a line here only when a *load-bearing* call actually changes.
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
`tsc -b` + `eslint .` + `vitest run` + `playwright test` + `vite build`, all green. Screenshots
are the visual oracle; `@axe-core/playwright` (light + dark + a modal) is the a11y oracle.
