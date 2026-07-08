# Needs input

Open product questions to revisit with the owner. Don't silently resolve these — flag them.

## Accepted for alpha (owner, 2026-07-03) — must clear BEFORE the repo goes public
A pre-launch review (2026-07-03) found these; the owner explicitly accepted them for the current
manual-demo alpha stage. They are tripwires, not resolutions — each must be cleared before the
repository is made public:
- Real client references ("Cohesion Labs", staff names in quoted booking notes, the partner
  studio name) in NEEDS-INPUT.md, docs/production-plan.md, docs/runbook.md,
  docs/decisions-log.md — scrub/anonymise all of them (including this line).
- The live alpha domain published in DECISIONS.md and the ops docs while that instance runs open
  (no auth) — scrub the URL AND lock down or tear down the host first.
- The auth-off demo posture: the fake sign-in gate appears on ANY auth-off server deploy, not
  just the demo build — revisit once real auth lands. (The other half of this item — the
  auto-seeded demo dataset landing in real server DBs — was RESOLVED 2026-07-04: the boot seed is
  now opt-in `CAPACITYLENS_SEED_DEMO=1`, and instances default to single-company —
  `CAPACITYLENS_MULTI_ACCOUNT=1` to allow more. See DECISIONS.md › Architecture.)
- No 1:1 account-owner ↔ company isolation (Stage C auth work) — required before exposing
  isolated user data publicly (already tracked under "Genuinely open").

## Resolved (owner-confirmed, 2026-06-24) — shadcn/ui adoption trade-offs
- **SelectField stays a native `<select>`; WeekdayPicker stays plain `<button aria-pressed>` chips.**
  Both deferrals from the shadcn adoption were accepted by the owner as-is — "both acceptable
  trade-offs" (Owner, 2026-06-24). So two of the four named "opinionated custom" replacements landed
  differently than the maximal plan: Toast→Sonner, icons→lucide, and command-palette→cmdk all
  shipped, but **native select → Radix Select did NOT** — Radix Select (a button + portalled
  listbox, no native change event) can't pass the existing tests verbatim (`ui.test.tsx`
  `user.selectOptions` + ~32 e2e `selectOption()` across 12 specs hard-require a native `<select>`),
  and the branch's hard invariant is "`ui.test.tsx` passes verbatim; never edit tests to fit Radix";
  the native select is also more robust on mobile/keyboard. **WeekdayPicker** kept its plain
  Tab-reachable `<button aria-pressed>` chips because shadcn ToggleGroup was a net-negative keyboard
  regression (roving tabindex + nested `role="toolbar"`, with capacitylens owning the `Weekday[]` model).
  No further work; if Radix Select is ever wanted, it's a deliberate test-interaction update
  (open trigger → click option, keeping the behavioural assertions) + the 32 e2e calls.

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
  rotating freelancers, not a feature-parity build of any incumbent. (Promoted to DECISIONS.md.)
- **localStorage is demo-only.** Server cutover is planned within ~a week (of 2026-06-11), so
  multi-tab localStorage clobbering and related local-mode findings are accepted, not scheduled.

## Resolved by assumption (confirm)
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
  and OFF by default (`CAPACITYLENS_BACKUP_DIR`), enabled on the droplet.

## Resolved (owner-confirmed, 2026-06-16)
- **Server cutover EXECUTED — SHARED + OPEN.** The alpha demo is live in server mode on
  DigitalOcean+Forge. The owner dropped **both Basic Auth and per-tester Accounts** for this
  round — the goal was simply to persist a shared dataset so testers opening the same Account
  see the same data. Stranded-localStorage + open-destructive-API risks explicitly accepted.
  Full runsheet + verification: decisions-log 2026-06-16; ops in `docs/runbook.md`.

## Resolved (v0.11.0, 2026-06-26)
- **Persistence default — RESOLVED (flipped to server-backed, v0.11.0).** Server mode (empty env =
  same-origin API) is the default; localStorage is the explicit `VITE_CAPACITYLENS_DEMO=1` demo
  opt-in. See DECISIONS.md › Architecture.

## Open — before beta (owner-deferred 2026-06-16)
- **Build ships React in DEV mode.** The Forge deploy script keeps `NODE_ENV=development` for
  alpha → main chunk 646 kB vs 422 kB prod. Flip to `NODE_ENV=production` (keep
  `pnpm install --frozen-lockfile` so `tsx`/`vite` still install) and redeploy before beta.
- **No auth gate.** Add Stage C session auth (or at minimum Nginx Basic Auth) before exposing
  beyond the trusted alpha group (see Security posture in DECISIONS.md).
- **Phase 2 edge-hardening remainders** (not yet done on the droplet): Nginx security headers
  (CSP report-only → enforce), cache-control (`index.html` no-cache / `/assets` immutable —
  without it testers can get stuck on a stale build after a deploy), and re-running the restore
  drill on the droplet (P4.2). See `docs/production-plan.md` Phase 2.

## Genuinely open
- **Intro page frequency is once-per-device** (`capacitylens/introSeen`, default off — the post-login
  "What CapacityLens is" page in `src/components/IntroPage.tsx`). The owner may prefer it every login
  instead; that's a one-line change (don't read/persist `introSeen`, or reset it on sign-out). The
  copy is placeholder, single-sourced in `src/lib/introCopy.ts`, pending a human edit.
- **Built-in "Internal" client — shipped as a REAL builtin client; the virtual-only option was
  rejected (2026-06-20).** Internal is a persisted `Client` with `builtin: true` (one per account),
  so it can OWN real projects — the owner's stated requirement. A lighter **virtual-only** sentinel
  (no row; a fixed pseudo-id surfaced only in the client filter/labels) was considered and rejected:
  a virtual client can't own projects and would need special-casing at every client surface. If the
  owner later decides Internal should NEVER own projects, the virtual approach is reopenable — but it
  trades the "owns projects" capability away. (See DECISIONS.md; `shared/src/data/internalClient.ts`.)
- **From the Cohesion Labs sheet import (2026-06-11)** — real customer data, full detail in
  `_input/COHESION-DEMO-NOTES.md`:
  - Their sheet books an external partner studio (Dog Eat Cog) as a *bookable* row with real
    day amounts — live evidence for the parked third-party line, but bookable, not FYI-only.
    Imported as a contractor "person" for now.
  - Their visual language colour-codes rows by **person**; CapacityLens colours bars by
    project/client. Do owners want a "colour by person" schedule toggle?
  - "Poindexter 90min for Laura" — a booking referencing another person. Is a
    person↔person (or booked-for) link on allocations ever in scope?
- **Capacity advisory stays non-blocking.** Over-capacity / time-off overlaps warn at allocation
  time but never block the save (`lib/capacity.ts` `capacityAdvisory()`). Confirm owners want the
  soft warning, or do some want a hard stop on overbooking?
- **Per-WEEK aggregate over-capacity band?** The over-capacity red background is per-DAY only
  (`allocated > available` per day → a red day cell). A *week* reads red only because it CONTAINS
  red days. Should an entire week with aggregate over-allocation (week-sum allocated > week-sum
  available — e.g. light Mon–Thu but a crushing Friday averaging out to over) get a distinct red
  WEEK band, separate from per-day over? Currently a week reads red via its over-days only. (Owner
  to decide; no per-week aggregate signal exists today.)
- **Undo/redo affordance — RESOLVED (owner chose visible buttons, 2026-06-25).** The schedule
  toolbar now shows Undo/Redo icon buttons (`undo-button` / `redo-button`, disabled when the
  history stack is empty), alongside the still-global ⌘Z / ⌘⇧Z shortcut. (Buttons live on the
  schedule toolbar — the main editing surface; the keyboard path remains app-wide.)
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
