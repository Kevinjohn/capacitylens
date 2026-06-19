# Needs input

Open product questions to revisit with the owner. Don't silently resolve these — flag them.

## Parked (owner-confirmed, build much later)
- **Freelancer / contractor / external-supplier differentiation.** The "Temp" pill is
  **hidden for now** (component `TemporaryTag` kept but rendered nowhere; employment type is
  still captured on the resource form). There IS a real distinction to surface — freelancers,
  contractors and external suppliers are scheduled/budgeted differently — but the treatment
  still needs designing (a pill is the wrong shape). The **third-party line shipped separately**
  as the `external` resource kind (see *Resolved 2026-06-19*); this Temp-pill distinction for our
  OWN freelancers/contractors stays parked. (Owner, 2026-06-11.)

## Resolved (owner-confirmed, 2026-06-19)
- **Third-party line — BUILT as the `external` resource kind.** The parked third-party line
  shipped, reframed from "a row type, not a resource" to a third `ResourceKind` (`external`): it
  carries a **company name** (+ optional descriptor) and is **assignable to any task** — so it's
  tied to a client + project *through the task* and is **bookable** (resolving the Cohesion
  "bookable vs FYI-only" tension below) — but has **no hours / no capacity / no utilisation**
  (allocations persist `hoursPerDay: 0`). Managed on a dedicated **External** tab (out of
  Resources), rendered in a single **neutral** colour in a band **always at the bottom** of the
  schedule (disciplines on or off), and excluded from utilisation averages + the time-off picker.
  Promoted to DECISIONS.md; spec `e2e/external.spec.ts`. (Owner, 2026-06-19.)

## Resolved (owner-confirmed, 2026-06-11)
- **Scope: deliberately small.** Budgets/money, timesheets, hour-granularity tracking, and mobile
  views are **non-goals** — the product is a helicopter who's-busy view for small agencies with
  rotating freelancers, not a Float feature-parity build. (Promoted to DECISIONS.md.)
- **localStorage is demo-only.** Server cutover is planned within ~a week (of 2026-06-11), so
  multi-tab localStorage clobbering and related local-mode findings are accepted, not scheduled.

## Resolved by assumption (confirm)
- **Local-first by default.** Data is one `AppData` blob in `localStorage` (`floaty/v3`); no
  backend, no login. The optional server is off unless `VITE_FLOATY_API` is set. Confirm this stays
  the default — turning the server on for everyone is a behaviour change (shared dataset,
  last-writer-wins).
- **Tenant picker is not auth.** You pick an Account on load (`AccountPicker`) and the dataset is
  scoped to it; `activeAccountId` is never persisted. This is convenience scoping, not a security
  boundary. Confirm that's acceptable for the current (trusted) audience.
- **Import repairs, it doesn't reject.** Forms reject bad input; import + server strip/repair per
  record (clean text, clamp hours, fresh ids, drop dangling required FKs). Confirm owners want a
  forgiving import over a strict all-or-nothing one.

## Resolved (owner-confirmed, 2026-06-12)
- **Production-cutover decisions.** All seven Phase 0 calls for the production plan
  (`docs/production-plan.md`) made: seeded + Cohesion import at cutover; browser data
  throwaway; per-tester Basic Auth entries; one Account per tester; Node 24 LTS;
  no Sentry this round; **Better Auth** (third-party OSS) for the wired-but-off auth
  scaffold, SSO provider choice still deferred. Plus: daemon backups are configurable
  and OFF by default (`FLOATY_BACKUP_DIR`), enabled on the droplet.

## Resolved (owner-confirmed, 2026-06-16)
- **Server cutover EXECUTED — SHARED + OPEN.** The alpha demo is live in server mode on
  DigitalOcean+Forge. The owner dropped **both Basic Auth and per-tester Accounts** for this
  round — the goal was simply to persist a shared dataset so testers opening the same Account
  see the same data. Stranded-localStorage + open-destructive-API risks explicitly accepted.
  Full runsheet + verification: decisions-log 2026-06-16; ops in `docs/runbook.md`.

## Open — before beta (owner-deferred 2026-06-16)
- **Build ships React in DEV mode.** The Forge deploy script keeps `NODE_ENV=development` for
  alpha → main chunk 646 kB vs 422 kB prod. Flip to `NODE_ENV=production` (keep
  `npm ci --include=dev` so `tsx`/`vite` still install) and redeploy before beta.
- **No auth gate.** Add Stage C session auth (or at minimum Nginx Basic Auth) before exposing
  beyond the trusted alpha group (see Security posture in DECISIONS.md).
- **Phase 2 edge-hardening remainders** (not yet done on the droplet): Nginx security headers
  (CSP report-only → enforce), cache-control (`index.html` no-cache / `/assets` immutable —
  without it testers can get stuck on a stale build after a deploy), and re-running the restore
  drill on the droplet (P4.2). See `docs/production-plan.md` Phase 2.

## Genuinely open
- **From the Cohesion Labs sheet import (2026-06-11)** — real customer data, full detail in
  `_input/COHESION-DEMO-NOTES.md`:
  - Their sheet books an external partner studio (Dog Eat Cog) as a *bookable* row with real
    day amounts — live evidence for the parked third-party line, but bookable, not FYI-only.
    Imported as a contractor "person" for now.
  - Their visual language colour-codes rows by **person**; Floaty colours bars by
    project/client. Do owners want a "colour by person" schedule toggle?
  - "Poindexter 90min for Laura" — a booking referencing another person. Is a
    person↔person (or booked-for) link on allocations ever in scope?
- **Capacity advisory stays non-blocking.** Over-capacity / time-off overlaps warn at allocation
  time but never block the save (`lib/capacity.ts` `capacityAdvisory()`). Confirm owners want the
  soft warning, or do some want a hard stop on overbooking?
- **Undo/redo affordance.** Undo/redo is keyboard-only (⌘Z / ⌘⇧Z); the toolbar buttons are hidden
  on purpose pending a clearer affordance. Do owners want visible buttons, or is keyboard enough?
- **Shared server dataset for the demo — DONE (cutover executed 2026-06-16).** The demo now
  runs in server mode on DigitalOcean+Forge (daemon + `/api` proxy + persistent SQLite),
  build-time flag, no localStorage fallback. Diverged from the migration plan: **no Basic Auth**
  and **no per-tester Accounts** this round (shared + open — see the 2026-06-16 resolved block
  above and DECISIONS.md Security posture).
- **Real auth + per-account isolation.** Stage C of the migration plan (the big one). Today the
  server's `ownsRow` tenant check is defence-in-depth, not real isolation — account is
  client-asserted until session auth lands. Required before exposing isolated user data publicly.
- **Concurrency / conflict UI.** Server mode is last-writer-wins; optimistic concurrency needs a
  client-side conflict UI (Stage B), not just the env flag. Build only when concurrent edits matter.
- **Postgres.** `server/` is raw `node:sqlite` (no ORM), so a move to Postgres (Stage E) is a
  rewrite, not a config change. Only if the SQLite single-file model is outgrown.
