# Floaty — Full review, 10-feature roadmap, and one-month team plan

> **Status addendum (2026-06-12).** This is a dated snapshot; read it with two corrections.
> **Superseded — symbol/env names in this dated snapshot predate the CapacityLens rebrand**
> (`looksLikeFloaty`→`looksLikeCapacityLens`, `VITE_FLOATY_API`→`VITE_CAPACITYLENS_API`,
> `FLOATY_*`→`CAPACITYLENS_*`); see DECISIONS.md for current state.
> **(1) Scope:** the owner has since confirmed the product is *deliberately small* — a
> helicopter who's-busy view; budgets/money, timesheets, hour-granularity and mobile are
> **non-goals** (see DECISIONS.md). Roadmap items F1/F2 (reports, money) and F10 (mobile)
> are therefore superseded; weigh the rest against that bar. localStorage is demo-only with
> the server cutover imminent, so the multi-tab finding is accepted, not scheduled.
> **(2) Already fixed (2026-06-12, see decisions-log):** the TABLES drift hole, NULL-id
> rows, the parallel-lists hazard (all drift-proofed, `641f063`); no-`<form>`/Enter
> (`2ab569c`); the "Ignore weekends" label (`4f60dff`); F7 command palette shipped +
> hardened (`7e74b66`, `6619d96`); account-level calendar settings (timezone/week start,
> `97cff75`).

**Date:** 2026-06-11
**Method:** 9 specialist review agents (domain core, store, scheduler, persistence, server, UI/UX, testing, security, product strategy), every critical/high finding adversarially verified by an independent agent instructed to refute it; 26 agents, ~1.6M tokens. The scalability dimension, four stranded verifications, and all synthesis below were completed directly after the agent fleet hit a session limit. `npm run gate` was run fresh today: **green** (551 unit tests / 57 files, tsc + eslint clean, build OK, main bundle 406 kB / 127 kB gzipped with route-split list views). E2E was not re-run today; last commit (`a700543`) is on a green main.

---

## 1. Executive summary

**Verdict: this codebase is in unusually good shape for a month of full-time investment — the risk is not engineering quality, it is product surface.** Every reviewer, independently, opened with some variant of "unusually disciplined for a project this size." Zero critical issues survived adversarial verification. The architecture's three load-bearing bets — the pure shared domain core, the PersistenceAdapter seam, and multi-tenancy threaded through every entity — are all genuinely sound and already proven (two sibling repos re-target the same core; the server adapter is a true drop-in).

| Dimension | Score | One-line verdict |
|---|---|---|
| Shared domain core | 8/10 | Invariants defined once and genuinely shared; extensibility relies on ~12 hand-maintained parallel lists, half of which fail **silently** |
| State management (store) | 8/10 | True orchestrator; undo/redo clean; write-side tenancy airtight; **read-side** scoping is convention-only |
| Scheduler engine | 8/10 | Pure, tested, referentially stable core; ceilings: drag can't leave the viewport, rebuild is O(days×allocations) not the documented O(A+T+R) |
| Persistence & sync | 7/10 | Seam is real and proven; **multi-tab silently clobbers edits (confirmed high)**; two unload-flush loss windows in server mode |
| Server & API | 7/10 | Well-crafted for its posture; TABLES spec is the one drift hole in the "can't drift" guarantee; NULL ids insertable via direct POST; concurrency flag doesn't cover the batch route the client actually uses |
| UI/UX & components | 8/10 | Real design system, real focus management, a11y beyond the axe gate; no `<form>` anywhere (Enter never submits), kit missing toggle/tooltip primitives, no responsive story |
| Testing & QE | 8/10 | 551 unit + 89 E2E, coverage proportionate to risk; **no visual-regression baseline** despite "screenshots are the visual oracle"; tenant-switch flow has zero E2E |
| Security & integrity | 8/10 | Zero XSS sinks, parameterised SQL, layered import; posture honestly documented; Stage C remains the hard gate before any public exposure |
| Scalability (analysed inline) | 7/10 | localStorage model holds ~2–3 years for a 25-person agency; model rebuild is the first frame-budget ceiling; mitigations are cheap and known |
| Product strategy | 7/10 | Docs/decision system is a genuine asset; product is thin exactly where the incumbent monetises: **no money, no reporting, no collaboration workflow** |

**The single most important sentence in this report:** the marginal hour now buys more in product gaps (reports, money, phases, booking status) than in further hardening — but ~4 days of targeted hardening first (Sprint 0 below) converts several classes of silent future data loss into compile/test failures and makes the month's UI work safe to ship fast.

### Confirmed issues that survived adversarial verification

1. **[HIGH] Multi-tab localStorage use silently clobbers edits.** Whole-blob last-writer-wins from a stale in-memory base; the loss becomes permanent exactly when the user would discover it (reload/close). Undocumented anywhere. Reachable today.
2. **[HIGH→effective] Server TABLES column spec is unguarded drift.** A field added to shared types but not `server/src/tables.ts` is silently dropped on write while the 201 response echoes it back as persisted. Empirically demonstrated. This is the one gap in the repo's core "app and server can't drift" guarantee — and adding fields is the most likely thing a scrum team does.
3. **[HIGH→effective] Direct POST without an id stores unaddressable `id:null` rows** (SQLite TEXT PRIMARY KEY permits NULL). Two coexisting NULL-id accounts demonstrated. Two-line fix.
4. **[MEDIUM, confirmed-with-correction] ~12 hand-maintained parallel lists for entity extension**, six-plus failing silently (KNOWN_KEYS, sanitize switch, FK_TARGET, repair block, UPSERT_ORDER, CREATE_ORDER/SCOPED_ORDER/isScopedKey). Latent, not broken today; made concrete by the parked third-party-line entity.
5. **[MEDIUM, confirmed-with-correction] No `<form>` element anywhere** — Enter never submits any of the 8 modal dialogs. Friction not breakage; centrally fixable in the Modal kit.
6. **[MEDIUM, confirmed-with-correction] Kit gaps with divergence already started** — Settings' role=radiogroup widgets violate the ARIA radio keyboard pattern (invisible to axe); toggles exist in three unshared treatments.
7. **[HIGH, verified inline] No money dimension in the domain model** — zero rate/cost/budget/fee fields on any entity.
8. **[HIGH, verified inline] No reporting or historical surface** — utilisation is a forward-only 14-day window; the past is a 28-day scroll buffer; 8 routes total, none aggregate.

Findings **refuted** by verification (claimed by reviewers, killed by skeptics): one persistence claim, two testing claims (the server-workspace gate exclusion is *not* a trap — CI covers it; the frozen-clock coupling is documented in three places), one security claim, and the originally-high severities on items 4–6 above (downgraded with corrections). The adversarial pass earned its keep: roughly a quarter of claimed critical/high findings did not survive.

---

## 2. Dimension detail

### 2.1 Shared domain core — 8/10

**Strengths:** tenancy predicate defined once in a types-only leaf module with precise write semantics (absent row → no-op, cross-account → throw); import remap correct on genuinely hard cases (cross-table id collisions, duplicate source ids, parent-before-child repair mirroring ON DELETE) and tested for each; clamps/text-hygiene/date-range rules genuinely shared across store, import, and server; cascade semantics coherent client-side and mirrored 1:1 in the SQL DDL; import layered against data loss (`looksLikeFloaty` shape guard, non-array-table rejection, zero-record refusal, confirmed + undoable); the cross-runtime contract is smoke-tested under real Node, not just asserted.

**Issues:** the parallel-lists hazard (confirmed, above); new-field server drift (confirmed, above); placeholder-project invariant can rot via parent edits then silently drop allocations on a later export/import round-trip; `migrate()`/`parseData` have no forward-version guard (a v4 file will be mangled, not refused); import fabricates default-valued records from non-object array elements; `safeWorkingDays` accepts fractional weekdays; shared-package purity is convention-enforced (Node globals typecheck inside the "pure" package).

**Do:** half-day of exhaustiveness wiring (derive KNOWN_KEYS from SCOPED_KEYS; type-level `satisfies`/never-asserts on every ordered list; never-default in the sanitize switch — or one vitest asserting all lists equal `Object.keys(emptyAppData())`); fully-populated per-entity round-trip fixtures defined once in shared and asserted in both server REST tests and import tests; one-line forward-version refusal; decide the placeholder-rebind story and encode it as a shared helper.

### 2.2 State management — 8/10

**Strengths:** the 592-line store is an orchestrator in the genuine sense (domain logic lives in shared; the store owns ids, timestamps, active account, undo stack; persistence is wired outside via subscribe); undo/redo is snapshot-of-AppData with structural sharing, 50-entry cap, history cleared on account switch, and it composes correctly with server sync because the diff keys on `updatedAt` inequality; write-side tenancy (findOwned + assertScopedRefs) is airtight and well-tested.

**Issues:** "Delete company" promises irreversibility (type-to-confirm, "This cannot be undone") but is undoable via ⌘Z at the picker — two contradictory contracts in one action; read-side scoping seam is convention-only with one in-tree bypass (`AllocationBar.tsx:66`) and no lint enforcement; dead state (`selectedAllocationId`); no-change updates still create undo entries/bump `updatedAt`/trigger server PUTs; `useScopedData` recomputes per consumer (fine now, first scaling cliff later).

**Do:** resolve the delete-company contract (clear history in `deleteAccount`, or change the copy); add an ESLint `no-restricted-syntax` rule banning `.data` member access outside `src/store/**` and fix the AllocationBar bypass; treat the existing store tests as the characterisation suite DECISIONS.md asks for (they drive only the public `getState()` API) — the bar genuinely gates only grid/viewport splits; extend the mechanical ~35-line pattern for the next entity, don't build the parked CRUD factory for one entity.

### 2.3 Scheduler engine — 8/10

**Strengths:** the three load-bearing computations (view-model, vertical windowing, gesture math) are pure, DOM-free, unit-tested modules; the React layer shows unusual care (rAF coalescing, lane-rect snapshotting, drag-pinning so virtualization can't orphan a live gesture, preview geometry that exactly matches commit geometry); the two-over-signals invariant is implemented faithfully and tested.

**Issues (ceilings, not defects):** pointer drags cannot reach beyond the current viewport — no edge auto-scroll, frozen virtual window mid-drag, pixel-delta date math; model rebuild is O(days × allocations), not the documented O(A+T+R), and reruns on every mutation, filter change, zoom flip, and live-resize frame; `utilization()`/`overAllocatedInWindow()` are dead app code duplicating the model's inline loop (drift risk); the screen-reader summary mislabels over-capacity working days as "zero-capacity days"; keyboard nudge lacks pointer-path feedback parity and there's no Escape-cancel for drags.

**Do:** fund drag-reachability (edge auto-scroll + content-anchored pointer math) **before** building more drag-adjacent features — split allocations and milestone dragging will inherit whatever exists; when the third-party row lands, make `RowModel` a discriminated union (`kind: 'resource' | 'external'`) — the Item-flattening/heights seam and virtualWindow are already row-shape-agnostic, so bottom-pinning is cheap; bucket per-resource allocated hours by day inside `buildSchedulerModel` and correct the DECISIONS.md O() line; implement recurring allocations as a materialisation step *before* the model, never inside it.

### 2.4 Persistence & sync — 7/10

**Strengths:** minimal, proven adapter seam; corrupt-vs-unavailable LoadError taxonomy routes to distinct recovery UIs with autosave deliberately detached so recoverable bytes can't be overwritten; the diff-to-transactional-batch design (updatedAt-inequality, upserts-before-deletes, coalesce-to-latest, lastSynced advances only on success, idempotent server batch) is the right shape for cutover; failure-path unit coverage is unusually thorough.

**Issues:** **multi-tab clobbering (confirmed high, above)**; the unload flush only covers the pending-debounce window — an in-flight non-keepalive fetch aborted by tab close and a failed write stranded in its 30s backoff are both lost in server mode; `visibilitychange→hidden` flush swallows errors while the page is still alive; keepalive flush silently fails above the 64KB body cap (import and large undo can exceed it); quota exhaustion gets the wrong "we'll keep retrying" banner; `applyOps` is dead code with a stale docstring.

**Do:** flush on pagehide whenever state is *unconfirmed*, not just when a debounce is pending (the diff makes redundant flushes free); decide the multi-tab story and write it into DECISIONS.md — cheapest is a `storage`-event "changed in another tab" guard that detaches persistence, sturdier is Web Locks single-writer election; note for Stage B that updatedAt 409s cannot see delete-vs-edit races (a PUT against an absent row is a fresh upsert — concurrent editors silently resurrect deleted rows minus their cascaded children; real conflict handling needs tombstones or server versions); cheapest demo-staleness fix is a visibility-regain `GET /api/state` + replaceAll when no local dirty state.

### 2.5 Server & API — 7/10

**Strengths:** transactional `/api/batch` with load-bearing op ordering correctly solves the reparent-vs-cascade race; introspection-gated migration + `assertSchemaCurrent` is more robust than most small projects ever build; error/CORS hygiene fail-closed; validation genuinely reuses the shared core; `ownsRow` is a single funnel every mutating route uses (which makes Stage C structurally tractable).

**Issues:** **TABLES drift hole (confirmed, above)**; **NULL-id rows via direct POST (confirmed, above)**; `FLOATY_OPTIMISTIC_CONCURRENCY` guards only the per-entity PUT route — `/api/batch` (the only write path the shipped client uses) and PATCH bypass it, so Stage B as planned would ship zero conflict detection; `validateWrite` materializes the entire database per write (and per op inside a batch); no indexes on FK columns; `assertSchemaCurrent` doesn't detect FK/ON DELETE drift; README omits the batch route.

**Do:** close the TABLES drift hole before the month starts (type-level exhaustiveness or per-table full-fixture round-trip test); require a string id on POST + NOT NULL on id columns (two lines); treat the concurrency flag as nonfunctional until the updatedAt check covers the batch loop — and prefer a server-owned version token over client wall-clock for Stage B; note that route atomicity is currently *implicit* in the synchronous driver — that, not the ~160 lines of SQL, is the real cost of any async-driver/Postgres move; keep raw node:sqlite for now (right call at this scale).

### 2.6 UI/UX & component architecture — 8/10

**Strengths:** semantic token theming with per-theme AA-tuned pairs; Modal with a real focus trap, focus restore, dirty-guard, drag-safe backdrop dismissal; consistent field kit with aria-invalid/aria-describedby wiring proven by E2E; CRUD pages genuinely uniform via ListPage + useCrudListState + useFieldError; a11y beyond the axe gate (keyboard drag/resize equivalents, sr-only capacity summaries, skip link, reduced motion).

**Issues:** **no `<form>` anywhere (confirmed; Enter is a silent no-op in all 8 dialogs)**; **Settings radiogroups violate the ARIA radio keyboard pattern; toggles in three unshared treatments (confirmed)**; "⌘Z" hardcoded in six user-facing strings on an app whose handler also accepts Ctrl; NumberField coerces empty input to 0 mid-keystroke; keyboard move/resize is silent (no toast/advisory, errors swallowed); two dead tooltips behind `pointer-events-none`; no responsive story and no documented mobile non-goal; SPA navigation invisible to assistive tech, unknown URLs dead-end; ColorField is a 52-tab-stop slog; `role="grid"` promises an unimplemented keyboard pattern; AllocationModal deletes without confirmation (out of step with every other delete); single-slot notice channel lets info overwrite a persistent error.

**Do:** 1–2 day kit-completeness pass **before** feature work (Form-wrapped Modal with Enter-to-submit; Checkbox/Switch/SegmentedControl/Tooltip primitives; NumberField draft-string fix; platform-aware shortcut label; correct radio pattern) — every item is a multiplier; get an explicit owner decision on mobile and record it whichever way it goes; close keyboard/pointer parity on the scheduler; add per-route `document.title`, a catch-all 404, and a virtualized-grid Tab-traversal E2E.

### 2.7 Testing & quality engineering — 8/10

**Strengths:** 551 unit tests in ~9.5s; 89 Playwright tests (85 localStorage + 4 db-backed full-stack); coverage genuinely proportionate to risk, including the rare kinds (retry/backoff, corrupt-data refusal, pointercancel teardown, prototype-pollution import); role/label-first selectors with state-over-pixel assertions; frozen clock correctly placed and documented in three locations; the server-workspace gate exclusion is **not** a trap (CI runs `gate:server` on every push; `npm run e2e` boots the real SQLite server).

**Issues:** "screenshots are the visual oracle" is four ad-hoc artifacts with **no baseline comparison** — effectively no visual regression on the eve of a month of UI work; the characterisation tests DECISIONS.md requires before grid splits don't exist (the gate is currently unsatisfiable); the local gate type-checks shared/ under the app's DOM lib so shared-only type errors only fail in CI; zero E2E coverage of the tenant-switch flow; db-backed E2E covers clients only; residual fixed-time waits; axe scope is three surfaces.

**Do:** stand up `toHaveScreenshot` baselines (scheduler light/dark + a modal + a list page) before the first UI change lands — the single highest-leverage addition for this month; write the grid characterisation suite as day-1 work (recenterToken/scroll, zoom date-anchoring, back-buffer math, virtual-window churn); add `npm run type-check --workspace=shared` to the root gate (one clause, sub-second); write the ~30-line tenant-switch E2E.

### 2.8 Security & data integrity — 8/10

**Strengths:** SQL fully parameterised, identifiers drawn only from the closed TABLES whitelist; zero XSS sinks (no dangerouslySetInnerHTML/innerHTML/eval, no URL-derived rendering); layered import with a prototype-pollution regression test; server errors redacted through one funnel; the threat model is honest and written down.

**Issues:** `GET /api/state` returns every tenant's data and `/api/import` can replace any tenant's slice — fine for trusted friends, fatal for public multi-user (this *is* Stage C, correctly gated); import preserves arbitrary unknown fields (uncapped localStorage payload channel + local/server divergence); the CSP host-header plan has unbuilt dependencies in the artifact (inline theme script and inline styles need hashing) and nothing in-repo records the intended policy; server accepts unvalidated ids/timestamps — and Stage B as planned would trust the client's clock.

**Do:** hold the documented line (nothing beyond the Basic-Auth demo gets a server URL before Stage C; make the Stage C merge gate a tenant-isolation suite covering attacker-asserts-victim-accountId on every route); strip unknown fields on import by projecting onto a shared per-entity field list (promote the server's column lists into shared/ as the single schema-field source — this also fixes 2.5's drift hole); document the concrete production CSP header inside the migration plan's nginx step now; clamp ids/timestamps in `sanitizeWrite`.

### 2.9 Scalability & performance limits — 7/10 (analysed inline; arithmetic below)

**The blob ceiling.** One allocation serialises to ~322 bytes (measured). A 25-person agency booking ~3–5 allocations/person/week generates ~4–6.5k allocations/year ≈ 1.3–2.1 MB/year, plus resources/projects/tasks (small). Against a ~5 MB localStorage budget: **~2–3 years of history for a 25-person agency; under a year for ~100 people.** This is a real but slow-moving ceiling, and the server cutover (SQLite has no such limit) plus an eventual archive/purge of past allocations are the answers. Not a this-month problem; worth a quota-meter in Settings.

**The write cost.** Every debounced write (300ms) is a full `JSON.stringify` of AppData. At 3 MB that's tens of milliseconds per edit on desktop — borderline but debounced; acceptable until the blob ceiling bites anyway. Same mitigation.

**The frame-budget ceiling (first to actually bite).** The scheduler model rebuild is O(days × allocations) and reruns on every mutation, filter change, zoom flip, and live-resize frame. At ~100–150 visible days × 2k scoped allocations it's fine; at 10k allocations live-resize will exceed frame budget. The fix is known and cheap: bucket per-resource hours by day inside `buildSchedulerModel` (the `capacityAdvisory` pattern). Do it opportunistically when reports work touches the same code.

**Undo memory.** 50 snapshots with structural sharing — each mutation duplicates only the changed table array (~80 KB of pointers at 10k allocations) → ~4 MB retained at cap. Fine. Import snapshots are full-data; also fine at current scale.

**Bundle.** 406 kB eager (scheduler is deliberately the eager index route), list routes split — healthy. Rule for the month: any charting library for Reports must be lazy-loaded with the route; that's the one realistic way the bundle doubles.

**Server mode.** `validateWrite` materializes the whole DB per write (per op in a batch) — quadratic-ish on large imports; fine for the demo, fix before any real scale. No FK indexes yet (trivial to add when row counts justify).

**Net:** for the target market (10–50 person agency) nothing here blocks the month; the cheap mitigations are listed in Sprint 0/backlog.

### 2.10 Product strategy & future-proofing — 7/10

**Strengths:** the DECISIONS.md / NEEDS-INPUT.md / decisions-log system gives an incoming team the "why" behind every constraint — a genuine onboarding asset; the migration plan is honest about its own structural risks (build-time flag, stranded-data rollback) and correctly trigger-gates Stages B–E; the seam architecture is proven future-proofing (two sibling repos re-target it).

**Issues (this is where the month should go):** **no money anywhere in the domain model (verified)**; **no reporting or historical view (verified)** — utilisation is a forward-only 14-day window, the past is a 28-day scroll buffer; time-off is plain CRUD with no workflow; **phases exist in the data model but their UI is hidden**; mobile is a zero with no recorded decision; the Stage-A backup design (cron `cp` of a live SQLite file) is unsafe — `.backup`/`VACUUM INTO` and a *tested* restore belong in the cutover gate, not deferred to Stage B; the build-time mode fork risks a month of features rotting server mode unless it's in the routine gate; the riskiest trajectory assumption is that whole-blob LWW + client snapshot undo can be incrementally hardened into multi-user without rework — concurrent editors plus snapshot undo is an architectural cliff the plan's one-line "conflict UI" undersells.

**Do:** put the month into reports + money + phases + booking status (all compound; further hardening doesn't); capture data now that Stage C will need (nullable actor fields on writes; record the snapshot-undo single-writer constraint in DECISIONS.md); fix the Stage-A backup plan before executing it; bring server mode into the routine gate or explicitly declare it demo-frozen for the month.

---

## 3. Cross-cutting themes (the connective tissue between dimensions)

1. **Silent parallel-list drift is the one systemic weakness.** Domain-core's ~12 lists, the server's TABLES spec, UPSERT_ORDER, the sanitize switch — same failure shape everywhere: extension by convention, failing silently in server mode or import. One Sprint-0 theme (exhaustiveness asserts + shared full fixtures + promoting field lists into shared/) closes the whole class.
2. **Single-writer assumptions run deeper than the docs say.** Multi-tab clobbering, LWW with no mid-session pull, no tombstones, whole-AppData undo snapshots, client-asserted accountId, client wall-clock as the concurrency token. Each is individually documented or defensible; together they mean "add collaboration later" is a cliff, not a slope. The month should *capture data* for Stage C (actor fields, server-stamped versions) without building it.
3. **Keyboard users are second-class on exactly the surfaces that matter.** Enter never submits; keyboard allocation moves are silent; radio groups don't arrow; drags have no Escape. The pointer experience got the care; parity is a kit-level pass, not per-feature work.
4. **The two build modes will diverge under feature pressure.** localStorage mode is gate-covered everywhere; server mode has 4 E2E tests and the drift holes above. Either expand db-backed E2E in Sprint 0 or declare server mode demo-frozen for the month in DECISIONS.md.
5. **The QA tooling is one notch behind the ambition of "a month of UI/UX work."** No visual baselines, unsatisfiable characterisation-test gate, untested tenant switch. All three are first-week QA tasks below.
6. **Honest gaps in this review** (where a completeness critic would have pushed): timezone/DST behaviour of the YYYY-MM-DD string date model around week boundaries was not deeply audited (the string-compare hot path is sound, but week-start/locale conventions are untested against non-UK locales); i18n/currency formatting (about to matter the moment money lands); print/PDF output; browser-support matrix. None block the plan; flag them into NEEDS-INPUT.md.

---

## 4. The next 10 features (the roadmap)

Ordered by leverage. Effort is for the assumed team (1 designer, 2–3 devs, shared QA): S=days, M=~1 week, L=~2 weeks, XL=more.

**F1. Reports & utilisation analytics (M-L).** A `/reports` route: utilisation by person/discipline/client/project over an arbitrary date range (past *and* future — today the past is unreachable beyond 28 days of scroll), capacity vs booked vs time-off, CSV export. *Why first:* it's the #1 thing the incumbent monetises, the product review's top gap, and it's pure aggregation over existing capacity code — no schema risk, high demo value. Lazy-load any chart lib. Touches: new route + selectors over `scopedTables()`; reuse `capacityAdvisory` math; opportunity to do the per-day bucketing (2.9).

**F2. Money: rates, budgets, burn (M, schema-first).** Optional `hourlyRate` (cost and/or charge) on Resource, optional `budget` (hours and/or money) on Project; budget burn-down on the project list and in reports. *Why:* second-biggest market gap; schema lands early (with the new fixture/exhaustiveness discipline from Sprint 0 proving itself), UI follows. Sets up freelancer cost differentiation (F5). Needs: migrate bump + forward-version guard first.

**F3. Phases & milestones on the timeline (M).** The data model already has phases — the UI is hidden. Surface phase bands on project rows / under the date header, milestone diamonds, phase picker in the allocation modal (the task↔phase↔project triangle is already validated in shared). *Why:* cheapest visible product win in the repo; agencies plan by phase.

**F4. Booking status: tentative vs confirmed (M).** `status: 'confirmed' | 'tentative'` on Allocation; hatched/ghost rendering (the placeholder hatch pattern is precedent); toolbar toggle to include/exclude tentative from utilisation and the over-signals; bulk confirm on a project. *Why:* pitching is the agency workflow Floaty can't model at all today; also the natural place to resolve the NEEDS-INPUT capacity question (advisory vs hard-stop can differ by status).

**F5. Third-party line + freelancer/contractor treatment (L).** The two owner-parked items, designed together as specified in NEEDS-INPUT.md: an external-work row type (start/end only, no hours/capacity/utilisation, tied to client+project, **always pinned below all resources**), plus the freelancer/contractor/supplier distinction surfaced properly (not the hidden Temp pill). Engineering path is already scoped by the scheduler review: `RowModel` becomes a discriminated union; windowing/bottom-pinning is cheap; cost concentrated in `renderRow` + the model's per-row block. Sequencing: **after** Sprint 0's exhaustiveness work (it's a new entity — the 12-list hazard) and **with** F2's rate fields for freelancer cost.

**F6. Time-off workflow (M).** Types (holiday/sick/other), `requested → approved` status with approver display name, balance counters per resource per year, schedule rendering distinguishing requested (hatched) from approved (solid), filter in toolbar. Stays local-first (no notifications yet — that's post-auth); captures the actor/approver fields Stage C will want.

**F7. Search & command palette (M).** ⌘K: fuzzy-find resources/projects/clients/tasks, jump-to-person-on-schedule, jump-to-week, quick actions ("add allocation for…", "go to reports"). *Why:* the Monday-resourcing-meeting accelerator; cheap because all data is already in memory; big perceived-quality jump.

**F8. Visible undo/redo + activity affordance (S-M).** Resolve the parked NEEDS-INPUT question: toolbar undo/redo buttons with platform-aware labels (fixing the hardcoded ⌘Z strings), a transient "Deleted X — Undo" toast (single-notice-channel fix included), and the delete-company contract resolution from 2.2. Optionally a lightweight per-session activity list (writes also stamp actor when present — Stage C capture).

**F9. Shared-demo server cutover, done right (M ops + S code).** Execute the near-term migration move with this review's corrections: `.backup`/`VACUUM INTO` backups + *tested* restore in the cutover gate; `/api/health` + uptime alert; the persist.ts unload-flush fixes; visibility-regain refetch for staleness; multi-tab guard; NULL-id and TABLES-drift fixes (Sprint 0) as prerequisites; CSP header documented and applied at the nginx step; concurrency flag left **off** (it doesn't cover `/api/batch`). This is the platform track of the month — it makes the demo real without crossing the Stage C line.

**F10. Responsive/tablet pass + the mobile decision (M, decision first).** Owner decides scope (recommend: tablet-friendly read-only schedule + responsive list/forms; native mobile is a non-goal for now — record whichever way it goes). Work: sidebar collapse, toolbar wrap, touch affordances for scroll (drag-to-allocate stays desktop), `viewport` audit. *Why last:* real value, but only after the core product surface exists to be viewed.

**Explicit non-goals for the month** (trigger-gated per the migration plan, don't build ahead): real auth/Stage C, optimistic concurrency/conflict UI (Stage B — and the flag is currently a no-op for the real client anyway), Postgres, real-time presence, native mobile, notifications/email (needs auth + a sending identity).

---

## 5. The one-month team plan

**Assumed team:** 1 product designer, 2–3 frontend-leaning devs, 1 platform/full-stack dev, QA shared across the team (if there's a dedicated QA, give them the Sprint-0 QA column full-time). **Cadence:** four 1-week sprints — one hardening sprint, three feature sprints. **Working agreements:** every merge passes `npm run gate` + `npm run e2e` (+ `gate:server` when server/ is touched); `user-stories/REFERENCE.md` is updated *first* when routes/labels/testids change, then the affected stories; one line in `docs/decisions-log.md` per landed decision (append at the tail); schema changes follow the Sprint-0 fixture/exhaustiveness discipline and bump the version; load-bearing calls get a DECISIONS.md line edit.

**Definition of Done (all features):** gate + e2e green; axe scan on any new surface; visual baselines updated deliberately (never blindly); keyboard path with feedback parity; dark mode; works in *both* persistence modes (or the server-mode freeze is invoked explicitly); user story written/updated; decision-log line if a product call was made.

### Sprint 0 (Week 1) — "Make the month safe to go fast"

| # | Task | Owner | Size | Acceptance criteria |
|---|---|---|---|---|
| 0.1 | Exhaustiveness across parallel lists: derive KNOWN_KEYS from SCOPED_KEYS; type-level asserts on UPSERT_ORDER / CREATE_ORDER / SCOPED_ORDER / TABLES keys / FK_TARGET; never-default in sanitize switch (or one vitest vs `Object.keys(emptyAppData())`) | Platform | M (1.5d) | Removing any entity from any list fails compile or test; documented in DECISIONS.md |
| 0.2 | Shared fully-populated per-entity fixtures + round-trip tests (server REST PUT→GET deep-equal; import remap; localStorage adapter) | Platform | S (1d) | A field added to shared types but not tables.ts fails the gate |
| 0.3 | Server: require string id on POST (400 otherwise); NOT NULL on id columns; migration for existing DBs | Platform | S (0.5d) | NULL-id POST returns 400; schema assert covers it |
| 0.4 | persist.ts: flush on pagehide whenever state unconfirmed; surface visibility-flush errors; quota-specific banner copy | Platform | S (1d) | Existing persist test harness extended for both loss windows |
| 0.5 | Multi-tab guard: `storage`-event detach + "changed in another tab — reload" banner; DECISIONS.md line | Platform/FE | S (1d) | Two-tab E2E or unit proof; no silent clobber |
| 0.6 | Kit completeness: Form-wrapped Modal (Enter submits, respects dirty/validity); Checkbox/Switch/SegmentedControl/Tooltip primitives; NumberField draft-string fix; platform-aware shortcut label helper; ARIA-correct radio pattern; migrate Settings + toolbar + AllocationModal toggles onto them | FE dev 1 | L (3-4d) | Enter submits in all 8 dialogs; Settings radios arrow-navigate; one toggle idiom everywhere; axe + unit green |
| 0.7 | ESLint scoped-read rule (`.data` access outside src/store/**) + fix AllocationBar bypass; delete-company undo contract (clear history + keep copy); 404 route + per-route document.title | FE dev 2 | M (2d) | Lint fails on new bypasses; ⌘Z after delete-company does not resurrect |
| 0.8 | Visual-regression baselines: `toHaveScreenshot` for scheduler (light+dark), one modal, one list page | QA | S (1d) | Baselines in repo; intentional-update workflow documented |
| 0.9 | Grid characterisation suite (recenterToken/scroll, zoom anchoring, back-buffer math, virtual-window churn) — satisfies the DECISIONS.md split gate | QA/FE | M (2d) | Suite green; DECISIONS.md note that the gate is now satisfiable |
| 0.10 | Tenant-switch E2E (~30 lines); add shared workspace type-check to root gate; fix sr-only over-capacity label | QA | S (1d) | Gate includes shared tsc; tenant E2E green |
| 0.11 | Design: audit + tokens for Reports/Money/Phases/Tentative; **owner workshop** → decide mobile scope, capacity advisory vs hard-stop, server-cutover timing; record outcomes in NEEDS-INPUT/DECISIONS | Designer | full week | Hi-fi for F1+F2, wireframes for F3+F4; three owner decisions recorded |

### Sprint 1 (Week 2) — Reports + money schema + drag ceiling

| # | Task | Owner | Size |
|---|---|---|---|
| 1.1 | F1 Reports route: range picker, person/discipline/client/project grouping, capacity-vs-booked-vs-time-off, per-day bucketing in model (shared with 2.9 mitigation), CSV export, lazy-loaded charts | FE dev 1 + 2 | L |
| 1.2 | F2 schema: rate/budget fields end-to-end (shared types → migrate bump + forward-version guard → tables.ts + ALTER → fixtures — Sprint 0 discipline proves itself); minimal UI (resource form, project form) | Platform | M |
| 1.3 | Drag edge auto-scroll + content-anchored pointer math + Escape-cancel; keyboard-move feedback parity (notice + capacity advisory) | FE dev 3 (or 2) | M-L |
| 1.4 | Design: F3 phases/milestones hi-fi; F4 tentative treatment (with the capacity decision from 0.11); F5 third-party/freelancer exploration with owner | Designer | week |
| 1.5 | QA: reports correctness oracle (hand-computed utilisation fixtures); axe + visual baselines for new surfaces | QA | M |

### Sprint 2 (Week 3) — Phases, tentative, budgets UI

| # | Task | Owner | Size |
|---|---|---|---|
| 2.1 | F3 Phases & milestones on the timeline: phase bands, milestone markers, phase in allocation modal, phase filter | FE dev 1 | L |
| 2.2 | F4 Tentative vs confirmed: allocation status field (schema discipline), ghost rendering, utilisation include/exclude toggle, bulk-confirm per project; implement the owner's advisory/hard-stop decision behind a per-account setting | FE dev 2 | M |
| 2.3 | F2 budgets UI: burn-down on project list + reports integration (booked × rate vs budget) | FE dev 3 / Platform | M |
| 2.4 | F9 platform track: safe backups (`.backup`) + tested-restore script + `/api/health`; visibility-regain refetch; expand db-backed E2E beyond clients (scheduler CRUD + reload) | Platform | M |
| 2.5 | Design: F6 time-off workflow; F7 palette interaction model; F10 responsive spec per owner decision | Designer | week |

### Sprint 3 (Week 4) — The differentiators + cutover

| # | Task | Owner | Size |
|---|---|---|---|
| 3.1 | F5 Third-party line + freelancer treatment: new entity through the full checklist (now compiler-enforced); RowModel discriminated union; bottom-pinned external rows; freelancer badge/cost display per design | FE dev 1 + Platform | L |
| 3.2 | F6 Time-off workflow: types, request/approve states, balances, schedule rendering, filter | FE dev 2 | M |
| 3.3 | F8 Visible undo/redo + delete toasts + notice-channel fix | FE dev 3 | S-M |
| 3.4 | F9 cutover execution (if owner green-lit in 0.11): Forge daemon, nginx `/api` proxy + Basic Auth + documented CSP header, `VITE_FLOATY_API` build, seed/import decision, snapshot-before-demo runbook; concurrency flag stays off | Platform | M |
| 3.5 | QA: full regression vs all user stories; cross-browser pass; month-end report of axe/visual/e2e status | QA | week |
| 3.6 | Stretch (pull forward only if ahead): F7 command palette | any | M |

**Falls out of the month (next-up backlog, in order):** F7 palette (if not pulled in), F10 responsive build (decision made, spec ready), localStorage quota meter, scheduler day-bucketing follow-ups (month/zoom views), recurring allocations (materialisation pattern from 2.3), Stage B done right (server-version tokens + batch-route concurrency + tombstones + conflict UI), then Stage C (real auth — with the tenant-isolation test suite as its merge gate).

### Sequencing rules (the ones that prevent expensive mistakes)

1. **Sprint 0 is not optional.** F2 and F5 add fields and an entity; without 0.1–0.3 those are exactly the changes that silently lose data in server mode.
2. **Nothing public before Stage C.** The demo stays behind Basic Auth; `ownsRow` is not isolation. (Documented; the month must not erode it.)
3. **Don't flip `FLOATY_OPTIMISTIC_CONCURRENCY`.** It doesn't cover `/api/batch` — it would ship zero protection while looking like protection.
4. **Schema changes always:** shared types → migrate + version bump (forward guard) → tables.ts + ALTER → fixtures → both-mode tests. One PR per entity/field group.
5. **New entities follow the store's mechanical ~35-line pattern** — the parked CRUD factory stays parked unless the month adds 2+ entities (F5 is one).
6. **Capture for Stage C, don't build it:** nullable actor fields on writes (F6/F8 do this naturally); record the snapshot-undo single-writer constraint in DECISIONS.md.

---

*Review artifacts: workflow transcripts under the session directory; full per-dimension findings (strengths/issues/recommendations with file:line evidence) in the workflow output. Gate evidence: 551/551 unit tests, build green, 2026-06-11.*
