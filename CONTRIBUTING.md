# Contributing to CapacityLens

Thanks for your interest in CapacityLens — a server-backed by default, with an explicit in-browser
demo build, multi-tenant agency resource & capacity scheduler. The project is open source under **AGPL-3.0-only**, and contributions are
welcome. We favour **small, focused PRs** that do one thing well: one concern, its tests, the
green gate, and a one-line note in `docs/decisions-log.md`. That keeps changes easy to review
and easy to land.

This is a deliberately small product (a helicopter view of who's busy / free / overworked,
week by week). Before proposing a feature, skim `DECISIONS.md` and `NEEDS-INPUT.md` — budgets,
timesheets, hour-granularity and mobile views are explicit non-goals, not gaps.

## Dev setup

You need **Node 24+** — the version is pinned in `.nvmrc`, and the default `server/` workspace
relies on Node's built-in `node:sqlite`.

```bash
nvm use          # picks up Node 24 from .nvmrc
npm install      # installs the whole npm workspace
npm run dev      # full-stack dev: SQLite API (:8787) + web (:5173) together; needs Node 24
npm run dev:demo # Vite-only localStorage preview (no server, no Node 24)
```

The repo is one npm workspace:

- **(root)** — the web app (`src/`).
- **`shared/`** — `@capacitylens/shared`: the pure, environment-agnostic domain core (types,
  validation, integrity, cascade, import remap, migrate, seed), shared by app and server.
- **`server/`** — the **default** Node + `node:sqlite` REST API behind the same persistence seam.
  `npm run dev` boots it on `:8787` alongside the web app, and an unconfigured build talks to it at
  a same-origin `/api`. `VITE_CAPACITYLENS_API` only **overrides the backend origin** (e.g. a remote
  API), it doesn't turn the server on. See `server/README.md`.

Server-backed persistence is the default — your data lives in the SQLite-backed `/api` and is shared,
server-persisted. The in-browser `localStorage` build is an explicit demo opt-in
(`VITE_CAPACITYLENS_DEMO=1` / `npm run dev:demo`): no backend and no login, with data living on the
device. See `README.md` for more on running it and `server/README.md` for the default API.

## The green gate (verify before opening a PR)

Run these locally before opening a PR — they are how the green gate is enforced. **There is no
automated CI**: this project deliberately runs the gate locally (and again at review), so a PR is
expected to land every applicable gate green on the contributor's own machine. Don't push red.

```bash
npm run gate         # tsc -b && eslint . && vitest run && vite build  — the core gate, run on EVERY PR
npm run gate:server  # type-check + test the optional server/ workspace — run when you touch server/
npm run e2e          # Playwright on Chromium (boots its own dev server) — run when you touch UI/flows
```

Cross-engine Playwright coverage is **opt-in** (Vite-only, so no SQLite/auth server, no Node 24):

```bash
npm run e2e:webkit   # core specs on Safari/WebKit only
npm run e2e:firefox  # core specs on Firefox/Gecko only
npm run e2e:browsers # core specs on all three engines (Chromium + WebKit, then Firefox)
npm run e2e:all      # e2e:browsers PLUS the Chromium-only db/auth server specs (needs the servers + Node 24)
```

The `server/` workspace is intentionally **out** of the root `gate` (it needs `node:sqlite` and
has no browser build) — run it separately with `gate:server`. Keep all specs **browser-agnostic**:
no user-agent branching.

**The rule:** a PR must have `npm run gate` green; **plus** `gate:server` if you touched `server/`;
**plus** `npm run e2e` if you touched UI or a user-visible flow.

## Coding standards

**Required reading:** `DEFENSIVE-CODING.md` — the defensive-coding & commenting standard. The one
rule is **surface, never swallow**: every error must reach a human via a visible surface; no
`catch {}` on a data path; don't wrap pure functions or hot render paths; never soften the store's
integrity throws. It's short — read it whole before sending a change.

The binding engineering standards:

- **Modularity & seams** — one concern per module behind a named seam; cross-module access only
  through a public interface. Pure domain logic lives in `@capacitylens/shared`; app and server
  consume it, never re-implement it.
- **Clarity over brevity** — explicit over clever; descriptive names; small one-job functions;
  named constants (no magic numbers); match the file's existing idiom.
- **Mandatory TSDoc** — every exported function / class / type / module gets a TSDoc block: what
  it does, `@param`/`@returns`/`@throws`, and the *why* / invariant. A new export without TSDoc is
  an incomplete change.
- **Drift-proofing for AppData** — new AppData fields flow shared types → `shared/src/data/fixtures.ts`
  → `server/src/tables.ts` columns → `sanitizeImportedRecord` (compile-checked). Server-control
  tables (auth/membership/invites) are deliberately **outside** this path. Don't bypass it.
- **Tests are first-class** — each change ships its own unit/component tests; server behaviour ships
  an app-test; specs stay browser-agnostic.
- **Flag discipline** — new server runtime behaviour is `CAPACITYLENS_*` env-flagged and **off by
  default**; client build flags are `VITE_CAPACITYLENS_*` (a few stated exceptions, e.g. the audit
  log, are on by default).

Don't reinvent product or architecture decisions — they live in `DECISIONS.md`. For any
**user-visible** change, update `user-stories/REFERENCE.md`
**first** (routes / labels / `data-testid`s / seed data), then the affected story and its E2E spec.

## Developer Certificate of Origin (DCO) — required

Every commit must be **signed off** under the
[Developer Certificate of Origin](https://developercertificate.org/). Signing off certifies that
you wrote the contribution (or otherwise have the right to submit it) and that you agree to
license it under the project's **AGPL-3.0** licence.

Sign off by committing with `-s`:

```bash
git commit -s -m "your message"
```

That appends a trailer to the commit message:

```
Signed-off-by: Your Name <you@example.com>
```

Use your real name and an email you can be reached at. PRs whose commits are **not** signed off
will be asked to amend (`git commit --amend -s`, or rebase to add sign-off to earlier commits)
before they can be merged.

## Reporting security issues

**Do not** open a public issue for a security vulnerability — see `SECURITY.md` for the private
disclosure process.
