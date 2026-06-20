# Floaty — Standing decisions (digest)

Present-tense summary of the judgement calls that **still constrain the code**. Short by
design — read it whole. The dated blow-by-blow (every review/remediation round, with findings
and commit refs) lives in **[`docs/decisions-log.md`](docs/decisions-log.md)** — append-only,
not meant to be read whole. Source is the final authority; this is the index.

**Keeping it cheap:** new entries go in `docs/decisions-log.md` as one line + commit ref;
promote a call **here** only when future work must respect it, and edit the line here when a
promoted call changes (so the digest can't drift). See [`CLAUDE.md`](CLAUDE.md).

## Architecture
- **Local-first by default.** No backend, no login; data is one `AppData` blob in
  `localStorage` (`floaty/v3`).
- **Optional server behind one seam.** A Node + `node:sqlite` REST API (`server/`, off by
  default, `VITE_FLOATY_API=…`) plugs into the same `PersistenceAdapter`; nothing else changes.
  Server mode is last-writer-wins, no per-user isolation.
- **Multi-tenant by Account.** Every entity carries `accountId`; you pick a company on load
  (`AccountPicker`) and `activeAccountId` is never persisted. Scoped access goes through the
  `useScopedData` / `scopedTables()` seam.
- **Pure domain core is shared.** `shared/` (`@floaty/shared`) owns types, validation,
  integrity, cascade, import-remap, migrate, seed — imported by both app and server so they
  can't drift.
- **Entity extension is drift-proofed.** The parallel lists (KNOWN_KEYS, sanitize switch,
  FK_TARGET, UPSERT_ORDER, server TABLES/CREATE_ORDER/SCOPED_ORDER) are exhaustiveness-checked
  against the shared types, and fully-populated per-entity fixtures
  (`shared/src/data/fixtures.ts`) round-trip through the server REST tests — a new entity or
  field that misses a list fails the gate instead of silently dropping. Keep new fields
  flowing through this: types → fixtures → tables.ts columns (+ auto ALTER) → sanitize.

## Persistence
- **Debounced writes, flushed on unload** (`pagehide` + `visibilitychange→hidden`) so a tab
  close inside the debounce window doesn't drop the last edit.
- **Seed once, gated on a persistent marker** (not emptiness) — clearing all data does NOT
  re-seed.
- **Schema migrated on open** (introspection-gated, idempotent); `assertSchemaCurrent` throws
  loudly at startup on any required-column drift or `optional?`-vs-`NULL` mismatch, instead of
  failing silently on a later write.

## Import — repair, don't reject
- **Forms reject; import + server strip/repair.** Import sanitises per record (clean text,
  clamp hours, fresh id when missing), drops dangling **required** FKs (mirrors cascade) and
  unbinds dangling **optional** ones (mirrors set-null); one id-map **per table**.
- **Shape-checked before migrate** (`looksLikeFloaty`) so non-Floaty JSON can't wipe data;
  **confirmation dialog** + **undoable** `importData`; honest delta ("imported N, M skipped").
- **Caps** on file size + record count (self-DoS / JSON-bomb).

## Error handling & comments (open-source posture)
- **Surface, never swallow** — the standard is **[`DEFENSIVE-CODING.md`](DEFENSIVE-CODING.md)**
  (read it whole). A `catch` only re-throws with more context, routes the error to a visible
  surface (`FieldError` / `Toast` / `setNotice` / typed `LoadError` / a 503), or degrades to a
  documented default for **non-tenant device prefs only** (theme/util toggles/sidebar/rotate hint).
  No `catch {}` on a data path; no generic message replacing a specific one.
- **Two-tier model:** validators return a value / call `fail(field, msg)` and never throw; the
  write boundary (`mutations.ts`, store, `server/validate.ts`) throws a **user-safe message**; the
  UI catches and shows it. Typed/classified errors (`LoadError`, `ValidationError`, `AuthConfigError`)
  over stringly-typed ones.
- **Some `try/catch` is harmful by design.** Pure functions, hot render paths, the store's
  deliberate integrity throws, and total helpers (`errorMessage`) carry guard-comments saying *not*
  to wrap them — wrapping would hide corruption. Add safety as a clamp/early-return in the pure core.
- **Comments explain WHY for a junior; every exported symbol gets TSDoc** with preconditions and
  `@throws` (and what a throw *means*). Baseline audit + this standard: 2026-06-14 decisions-log.

## Scheduling & capacity
- **Three distinct over/utilisation signals, kept separate:** (1) the per-day **over-marker** flags
  *any* day where `allocated > available` (STRICTLY greater — at-capacity is NOT over; this also
  catches a zero-capacity day carrying work) across the whole timeline, rendered as a clear red
  background (`bg-danger-cell`, a strongly saturated red — the cell is EMPTY so no text-contrast/AA constraint binds it, unlike the `danger-soft` BUTTON tint) per over-day; (2) the **displayed utilisation %** (per-person,
  per-discipline avg, overall — all derive from one per-row `utilization`) is a working-day-only ratio
  over the currently **VISIBLE window** — the 1/2/4/8-week zoom span anchored at the scroll left-edge,
  `[L, L + zoom*7 − 1]` (inclusive end, clamped to the last timeline day), recomputed **day-quantized**
  on zoom/pan (the left-edge DAY index, not per scroll pixel — no per-pixel model rebuild); (3) the
  `overSoon` red flag stays a working-day-only ratio over a **fixed forward 14-day window from today**
  (`UTILIZATION_WINDOW_DAYS`), zoom/pan-independent (the second "over soon" warning). They answer
  different questions — don't merge them. SchedulerGrid threads both windows into `buildSchedulerModel`
  (`visStart/visEnd` for the %, `overStart/overEnd` for the flag).
- **Blocks mode allows `hoursPerDay: 0`** (span counts, load ignored); resources still require `> 0`.
- **Capacity advisory at allocation time is non-blocking** (warns on over-capacity / time-off
  overlap; save still allowed). One source: `lib/capacity.ts` `capacityAdvisory()`.
- **Calendar is account-level** (like `schedulingMode`): `timezone` (IANA, default GMT) and
  `weekStartsOn` (default Monday) live on the Account so the whole team shares "today" and
  week boundaries — they drive the Today snap, header week blocks, lane dividers, and form
  date defaults via `todayISO(timeZone)` / `startOfWeekISO(date, weekStartsOn)`. The weekend
  TINT stays Sat/Sun regardless of week start.
- **Disciplines are optional (account-level)** — `disciplinesEnabled` on the Account (absent =
  true; Settings → Disciplines). Off hides disciplines across the WHOLE UI (nav + `/disciplines`
  route guard, resource-form field, schedule grouping + filter, Resources list, command palette,
  the Settings discipline-utilisation toggle) and renders the schedule FLAT (one all-resources
  group, no bands) — the discipline data is preserved and returns when re-enabled. Any new
  discipline surface MUST gate on `disciplinesEnabledFor(data, activeAccountId)`.

## UI & product
- **Deliberately small (owner, 2026-06-11).** Floaty solves ONE problem — a helicopter view of
  who's busy, free, or overworked, week-by-week — for small agencies with few staff and rotating
  freelancers. Owner-confirmed non-goals: budgets/money, timesheets, hour-granularity workflows,
  mobile views (light mobile *affordances* are in scope — next bullet), per-seat/per-feature
  gating. Reject features that add process or granularity.
- **Light mobile affordances, not mobile views (owner, 2026-06-12).** Nav links carry icons;
  the sidebar collapses to an icons-only rail (device-global `floaty/sidebar`, default
  collapsed on small screens — `(max-width:767px), (max-height:480px)`) whose rail icons just
  re-open the menu, never navigate (they're `aria-hidden`; the labelled Collapse/Expand toggle
  is the single accessible control); portrait phones get a dismissable session-scoped
  "Best in landscape" hint (`floaty/rotateHintDismissed`, shown over the account picker too).
  A phone is a glanceable surface, not a workflow surface — don't grow this into mobile views.
- **"Utilisation" is the term** everywhere on the schedule (not "Load").
- **Filtering by client/project hides non-matching resources** by default; the
  "Show unallocated" toggle opts the visible-but-dimmed staffing view back in.
- **Activities have a required `kind` (project | internal | repeatable).** A `project` activity carries a
  projectId (+ optional phase); `internal` and `repeatable` are project-less (so are their
  allocations) — coherence is enforced at the write boundary (`assertScopedRefs`) and repaired on
  import/migrate. "Repeatable" is the rename of the old "general" activity — a reusable activity across
  projects; "internal" is the new bucket. The schedule's **activity lens** ("Filter by activity", grouped
  by kind) is a **standalone** view, mutually exclusive with the client/project filter (enforced in
  `setFilters`). The Activities page shows three sections (Internal, Repeatable, Project).
  **The domain concept was renamed Task→Activity (schema v5):** `Activity`/`ActivityKind` types,
  `Allocation.activityId`, the `activities` table/array/REST segment/route (`/activities`); legacy
  `tasks`/`taskId` blobs migrate on load + import (`migrateV4toV5`, server `renameLegacyActivityTables`).
- **The built-in "Internal" client is a REAL `Client`, one per account (schema v6).** A persisted
  client with `builtin: true` (NOT a sentinel id), name "Internal", identified at runtime by the FLAG
  (so it survives import-remap). Seeded, created by `addAccount`, and ensured by `migrateV5toV6` +
  server `openDb` — all idempotent (one per account, never duplicated). **Protected:** the store throws
  on renaming/deleting a builtin and the ClientList hides those affordances. It can own real projects.
  **Project-less internal/repeatable activities bucket under it for DISPLAY + FILTER only** — there is
  NO `activity.clientId` and `assertScopedRefs` is unchanged; the association is DERIVED in
  `schedulerModel.activityMeta` (a project-less activity's client = the account's builtin Internal id,
  never persisted), so `matchesProjectClient` makes Filter-by-Internal return BOTH project-less work and
  Internal-owned-project work. Import normalises to exactly one builtin per account. Helper:
  `shared/src/data/internalClient.ts`.
- **The timeline keeps a 4-week scrollable back-buffer** (`PAST_BUFFER_DAYS`) to the left of
  the focus date — the view opens flush at the focused Monday, and scrolling left pans into
  the past instead of overscrolling (macOS turns left-edge overscroll into browser back;
  `overscroll-x-contain` on the grid guards the buffer's own edge).
- **Theme is device-global** — own key (`floaty/theme`), NOT in `AppData`/export. Default
  **light**; `system` follows `matchMedia`; FOUC guard in `index.html`.
- **Utilisation display toggles are device-global** too (`floaty/utilizationPrefs`, default all-on).
- **Bar labels carry `Client · Project` context** before the activity name, behind two
  device-global toggles (`floaty/barLabelPrefs`, Settings → Allocation bars, default both on);
  missing metadata just skips its part. The popover keeps its own activity-first layout.
- **Weekends minimise by default** — device-global `floaty/minimiseWeekends` (Settings →
  Schedule, default **ON**), NOT on the account / not in export. On = the Sat/Sun columns shrink
  to a rem-based sliver (`WEEKEND_COLUMN_REM`, capped at `dayWidth`, fine-zoom only) labelled a
  single **"S"**; weekends are never removed (weekend work + spanning bars still render). This
  makes the grid **variable-width**, so ALL px↔day↔date math runs through ONE `ColumnGeometry`
  (prefix-summed offsets — `columnGeometry.ts`): the view-model bar/time-off x/width, the header
  cell/month widths, every lane overlay, today/focus/scroll-anchor, AND the drag/resize inverse
  (`geom.indexAt`, the exact inverse of `geom.x`). Never reintroduce `index * dayWidth`; build new
  scheduler positioning on `geom`, and keep the live drag preview going through the same geom as
  the commit (so a drag across a narrow weekend can't jump on release). Two coupled invariants:
  (1) **integer-pixel widths** — `weekendWidth` is rounded to a whole px so every offset is whole,
  else the browser-rounded `scrollLeft` makes the zoom anchor's `indexAt` floor onto the weekend
  and the left-edge date drifts; (2) **weekend-aware zoom fit** — `resolveDayWidth` takes the
  weekend width and widens the weekday columns so a "1-week" view shows ~1 week (narrow weekends
  would otherwise under-fill it to ~1.5); `MAX_DAY_WIDTH` is 240 to let that fill a normal screen.
- **Undo/redo is keyboard-only** (⌘Z / ⌘⇧Z, global in `AppShell`); the toolbar buttons are
  intentionally hidden (clearer affordance is a TODO).
- **Modals are real forms.** `Modal` takes an optional `onSubmit` and wraps children+footer in
  a `<form noValidate>`; the primary action is `type="submit"` so **Enter submits every
  dialog** (all other buttons stay `type="button"` — the Button default). Keep new dialogs on
  this pattern.
- **⌘K / Ctrl+K command palette** (`CommandPalette`, fuzzy via `src/lib/fuzzy.ts`, no deps):
  jumps to people (scroll-to-lane), projects/clients (schedule filters), activities/pages, today,
  or a typed ISO date. Combobox/listbox ARIA; behaviours documented in REFERENCE.md.
- **Colours are preset swatches only** (no custom hex) → a stored colour is always a valid
  `#rrggbb`. Palette = 13 hues × 4 shades generated from HSL (`lib/palette.ts`).
- **Resource colour derives from its discipline** — no per-resource colour control.
- **Placeholders** bind to one project but may take *general* activities, so the modal's Project
  select stays **enabled but restricted** ("locked" = restricted, not immutable). In the
  schedule they sort after people and show a **`?`** avatar + diagonal hatch, named the literal
  **"Placeholder"** (role/discipline as secondary text — name interpreted literally per the
  acceptance; revisit if the owner wants numbering/the role).
- **Placeholders are behind a device-global setting, default OFF (owner, 2026-06-20).** Pure VIEW
  pref `floaty/placeholdersEnabled` (own key, default `false`, NOT in `AppData`/export — like
  theme/minimiseWeekends), Settings → **Placeholders** → *Show placeholders*. OFF (out-of-the-box)
  HIDES placeholders everywhere — the schedule row (so also their bars + utilisation contribution),
  the assignee picker, the command palette, and ResourceList's Placeholders section/Add button —
  but their data is untouched and returns when re-enabled (a dataset with placeholders hides, never
  errors). **Single hide chokepoint:** `buildSchedulerModel`'s `resourceVisible` (one filter does
  rows + bars + utilisation). Export/import + `useScopedData` + shared integrity/cascade are NOT
  gated. Editing an allocation already on a hidden placeholder still offers that placeholder in the
  picker (no silent reassign). Any new placeholder surface MUST gate on `placeholdersEnabled`.
- **External / 3rd parties are a resource kind (`external`), not a bookable lane (owner, 2026-06-19).**
  Outsourced work: a **company name** (`name`) + optional descriptor (`role`), **assignable to any
  activity** (no project restriction), but **no hours/capacity/utilisation** — allocations carry
  `hoursPerDay: 0` and the scheduler model skips all capacity reads for them. Single **neutral** colour
  (`resolveBarColor` short-circuits their bars, overriding the project-colour rule) in a band **always
  at the schedule bottom**, disciplines on or off; excluded from utilisation averages + the time-off
  picker. Resolves the "third-party line".
- **External is behind a device-global setting, default OFF (owner, 2026-06-20).** Like Placeholders:
  a pure VIEW pref `floaty/externalEnabled` (own key, default `false`, NOT in `AppData`/export),
  Settings → **External** → *Show external resources* (+ explainer copy, single-sourced in
  `lib/externalCopy.ts`). External moved OUT of its old standalone `/external` tab INTO the **Resources**
  tab — a gated **External** section after Placeholders; the `/external` route now redirects to
  `/resources` (no nav link, no command-palette page entry). OFF (out-of-the-box) HIDES externals
  everywhere — the schedule band (and its header doesn't render empty, since the model's
  `rows.length > 0` filter drops the now-empty band group), the assignee picker, the command palette,
  and the Resources-tab section — but their data is untouched and returns when on. **Single hide
  chokepoint:** `buildSchedulerModel`'s `resourceVisible` (threaded `externalEnabled`, exactly like
  `placeholdersEnabled`). Editing an allocation already on a hidden external still offers it in the
  picker (no silent reassign). Export/import + `useScopedData` + shared integrity/cascade are NOT gated.
  Any new external surface MUST gate on `externalEnabled`.
- **Unsaved-changes guard:** the modal closes only on a backdrop press that both starts and
  ends on the backdrop; once dirty, accidental dismiss (backdrop/Escape) is refused, and a
  `beforeunload` guard covers tab-close. Dirty also tracks `aria-pressed` toggle clicks.
- **A JS-less load is never silent white.** `index.html` ships a static `#root` placeholder
  ("Loading… if this doesn't go away, JavaScript isn't running") that React replaces on mount,
  plus a `<noscript>` banner — everything in this app (in dev, even the CSS) arrives via JS, so
  blocked scripts otherwise render a blank page with an empty console. Keep the placeholder
  when touching `index.html`.
- **Demo "fake sign-in" precedes the picker (cosmetic, 2026-06-16).** A Google-style *Choose an
  account* screen (`src/components/FakeSignIn.tsx`) gates the app **before** the account picker so
  a viewer sees "log in first, then pick a company". It is **not** real auth: a device-global flag
  (`floaty/fakeSignedIn`, default off, NOT in `AppData`/export) is flipped by clicking the account
  and cleared by **Sign out** (picker + sidebar, which also drops the active company). Mounted in
  AppShell **only** when `authMode === 'off'`, so it never stacks with the real login wall — the
  real, server-authoritative seam stays `src/auth/`. Persona/avatar: `src/lib/fakeAuth.ts` /
  `src/assets/avatar-demo.svg`. Story US-NAV-11; spec `e2e/fake-signin.spec.ts`.

## Text validation
- **Denylist, not allowlist.** Reject emoji + symbol-other, control/format/surrogate/private/
  unassigned, and keycap/variation-selector marks — but allow all letters/marks/digits/
  punctuation/whitespace + currency/math, so `José`, `Müller`, `O'Brien & Co`, CJK and `€£+=`
  pass. One definition in `shared/src/lib/strings.ts` (`MAX_NAME_LENGTH` 100 /
  `MAX_NOTE_LENGTH` 1000), used by client **and** server. Forms reject inline; import/server **strip**.

## Security posture (pre-share)
- **Alpha is live, SHARED + OPEN (owner, 2026-06-16).** The DigitalOcean+Forge demo
  (`small-saas-agency-resource-alpha.kevinjohngallagher.com`) runs in server mode — one shared
  dataset, last-writer-wins — with **no auth gate at all** this round: no app-level auth AND no
  Nginx Basic Auth (the earlier plan's Basic Auth gate was deliberately dropped). Anyone with
  the URL can read/edit/wipe the data; owner-accepted for the trusted alpha group only.
  **Before beta: add a real gate** (Stage C session auth, or at minimum Nginx Basic Auth) — see
  `NEEDS-INPUT.md` and decisions-log 2026-06-16.
- **Auth seam is wired but OFF.** `FLOATY_AUTH=off|password|sso` (Better Auth, sessions + login
  screen): off = byte-for-byte today, no auth tables, no login UI. The server-reported
  `authMode` is the only auth flag — no client-side flag exists.
- **Session ≠ isolation.** Turning `FLOATY_AUTH` on gates requests, but `accountId` stays
  client-asserted (`ownsRow` is defense-in-depth) until Stage C derives it from the session.
- **CSP:** `object-src`/`base-uri` ship in `index.html`; a full `script-src` policy belongs in
  a host response header, not the app — **not yet added at the host** (Phase 2 edge-hardening
  remainder, see `docs/production-plan.md`).

## Performance (and standing non-goals)
- **Row virtualization** is implemented (spacer windowing, pure window math; off-screen rows
  dropped, sticky column / flow / test markup unchanged).
- **Scheduler model is O(A+T+R)** — grouped id→entity maps + a single per-resource slice; the
  model `useMemo` keeps each row's slice referentially stable so `React.memo` on lanes/bars is
  effective.
- **Date hot path compares zero-padded `YYYY-MM-DD` strings** (`isWithin`) rather than re-parsing.
- **Deliberately NOT done at this size:** a generic store/CRUD factory or schema-driven forms;
  a custom listbox to replace native `<select>` (OS popup misalignment accepted);
  measurement-based row virtualization for font-scaling (body rows keep fixed px; only the date
  header uses `minHeight`); import id-dedup beyond repair.

## Testing & process
- **Green gate** = `npm run gate` (`tsc -b` + `eslint .` + `vitest run` + `vite build`) **and**
  `npm run e2e` (`playwright test`). The `server/` workspace is out of the root gate;
  `npm run gate:server` covers it. Node 24+ (`.nvmrc` + `engines`) — `node:sqlite` unflagged.
- **Cross-browser E2E is opt-in; Chromium is the default loop.** `npm run e2e` runs the
  chromium/db-backed/auth-backed projects on Chromium. `npm run e2e:webkit` and `npm run e2e:firefox`
  re-run the **core localStorage specs on WebKit/Safari** and **Firefox/Gecko** respectively (a
  `webkit` / `firefox` project, each mirroring `chromium`'s `testIgnore`). `npm run e2e:browsers`
  runs the **core specs on all three engines** (Chromium + WebKit, then Firefox), and `npm run
  e2e:all` is the superset — that plus the Chromium-only db/auth server specs. Both sequence the
  engines the same way — Chrome in parallel, then **Safari, then Firefox** (`scripts/e2e-browsers.mjs`
  / `e2e-all.mjs` each run a Chromium+WebKit invocation, then a SEPARATE Firefox invocation — so
  Firefox always runs second AND unconditionally, even after a red WebKit pass; the run fails if
  either engine fails. Deliberately NOT a `firefox` project `dependencies: ['webkit']`, which would
  *skip* Firefox whenever WebKit failed). Every core-specs-only run boots **only Vite** (`viteOnly` =
  `FLOATY_VITE_ONLY` for `e2e:browsers`, or either single-engine `*_ONLY` flag, trims the `webServer`
  list) so it needs neither the SQLite/auth servers nor Node 24. db-backed/auth-backed stay
  Chromium-only (server round-trips, not cross-engine rendering). Keep specs browser-agnostic — no
  UA branching; the pointer-drag/`page.clock`/`fill`/`Meta+z` patterns already pass on WebKit and Firefox.
- **Two oracles beyond "tests pass":** screenshots are the **visual** oracle (role/DOM
  assertions prove behaviour, not appearance); `@axe-core/playwright` is the **a11y** oracle
  (light + dark + a modal).
- **Dev server binds loud, not lucky:** `vite.config.ts` pins `host: '127.0.0.1'` (Node 17+
  would otherwise bind `localhost` → `::1` only) and `strictPort: true` (a squatted 5173 —
  including by floaty-schedule / delivery-diary, which claim the same port — fails at startup
  instead of silently serving 5174). A URL/socket mismatch presents as a blank page with an
  empty console; don't reintroduce either silent mode.
- **E2E freezes the clock** to a date inside the seed window (`2026-06-03`, the over-allocated
  day) in `e2e/helpers.ts` `openApp()`. The scheduler view is today-anchored (it opens scrolled
  to this week's Monday, with the origin a 4-week back-buffer earlier; the utilisation window
  runs forward from today) and the seed lives in early
  June 2026 — without a fixed clock the demo bars drift off-screen and the suite rots with the
  wall calendar. **Move this date if the seed dates move.**
- **Modularity:** only pure extractions land behind the green gate (the gate *proves* them
  safe); high-churn structural splits (store slice-by-concern, a viewport hook, grid
  render-splits) wait until a **characterisation test is written first**.
