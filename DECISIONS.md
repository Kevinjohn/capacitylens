# CapacityLens — Standing decisions (digest)

Present-tense summary of the judgement calls that **still constrain the code**. Short by
design — read it whole. The dated blow-by-blow (every review/remediation round, with findings
and commit refs) lives in **[`docs/decisions-log.md`](docs/decisions-log.md)** — append-only,
not meant to be read whole. Source is the final authority; this is the index.

**Keeping it cheap:** new entries go in `docs/decisions-log.md` as one line + commit ref;
promote a call **here** only when future work must respect it, and edit the line here when a
promoted call changes (so the digest can't drift). See [`CLAUDE.md`](CLAUDE.md).

## Architecture
- **Local-first by default.** No backend, no login; data is one `AppData` blob in
  `localStorage` (`capacitylens/v3`).
- **Optional server behind one seam.** A Node + `node:sqlite` REST API (`server/`, off by
  default, `VITE_CAPACITYLENS_API=…`) plugs into the same `PersistenceAdapter`; nothing else changes.
  Server mode is last-writer-wins, no per-user isolation.
- **Multi-tenant by Account.** Every entity carries `accountId`; you pick a company on load
  (`AccountPicker`) and `activeAccountId` is never persisted. Scoped access goes through the
  `useScopedData` / `scopedTables()` seam.
- **Pure domain core is shared.** `shared/` (`@capacitylens/shared`) owns types, validation,
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
- **"Clear local storage" wipes only `capacitylens/`-prefixed keys (owner, 2026-06-20).** Settings →
  **Local data** → a danger button (`clear-local-storage`) opens the destructive `ConfirmDialog`;
  Confirm calls `clearCapacitylensLocalStorage()` (`src/data/clearLocalStorage.ts` — iterates localStorage,
  removes every `capacitylens/`-prefixed key: the `capacitylens/v3` AppData blob + ALL device prefs, leaving
  unrelated origin keys), then `window.location.reload()`. Never a blind `localStorage.clear()`. Copy
  adapts to mode: server mode (VITE_CAPACITYLENS_API set) says the DB is safe and the app re-loads from it;
  local mode says this erases your only copy. A clear failure surfaces via `setNotice(…, 'error')`
  (user-triggered, so don't swallow).

## Deployment / self-host
- **One reproducible image, two services from one multi-stage Dockerfile** (Node 24 for
  build+`api`, `nginx:alpine` for `web`). `web` serves the built Vite SPA and reverse-proxies
  `/api/*` -> the `api` service (same-origin, so CORS stays fail-closed); `api` runs the
  Fastify daemon (`tsx server/src/index.ts`) with `CAPACITYLENS_HOST=0.0.0.0`, SQLite DB +
  backups on named volumes, HEALTHCHECK on `/api/health`. The server stays API-only — the SPA
  is NOT served by it (no `@fastify/static`).
- **`VITE_CAPACITYLENS_API` is the backend ORIGIN, never `/api`.** The client composes
  `${API_BASE}/api/...`, so `/api` would double-prefix and `""` disables server mode; build it
  as the published origin (compose default `http://localhost:8080`). `.env.example` documents
  every runtime env var (server + client) with accurate defaults.

## Import — repair, don't reject
- **Forms reject; import + server strip/repair.** Import sanitises per record (clean text,
  clamp hours, fresh id when missing), drops dangling **required** FKs (mirrors cascade) and
  unbinds dangling **optional** ones (mirrors set-null); one id-map **per table**.
- **Shape-checked before migrate** (`looksLikeCapacityLens`) so non-CapacityLens JSON can't wipe data;
  **confirmation dialog** + **undoable** `importData`; honest delta ("imported N, M skipped").
- **Caps** on file size + record count (self-DoS / JSON-bomb).

## Error handling & comments (open-source posture)
- **Surface, never swallow** — the standard is **[`DEFENSIVE-CODING.md`](DEFENSIVE-CODING.md)**
  (read it whole). A `catch` only re-throws with more context, routes the error to a visible
  surface (`FieldError` / a `Sonner toast` (driven by `setNotice` — the hand-rolled `Toast` is
  retired) / typed `LoadError` / a 503), or degrades to a
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
  *any* day where `allocated > available` (STRICTLY greater — at-capacity is NOT over) across the
  whole timeline. `allocated` is **weekend-aware** (`isWeekendAware`): a normal allocation does no
  work on the resource's non-working weekdays, so a weekend a bar merely **spans** is NOT over (it
  keeps only the cool "unavailable" weekend tint, its own `--c-weekend` token) — the zero-capacity days that DO read as over are a
  **time-off** day a working allocation covers (a real conflict) and a weekend an allocation opts
  into via `ignoreWeekends`. Rendered as a clear red
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
- **An allocation's hours/day is capped at `MAX_HOURS_PER_DAY` (24); the forms REJECT, not silently clamp.**
  `clampHoursPerDay` bounds it to `[0, 24]` at every write path (store + import + server). But the
  AllocationModal now rejects a days-mode work volume (Days-of-work over Days-over) — or an hourly value —
  that would *derive* `> 24h/day`, so the previewed "…h/day" always equals what saves. (Before, an over-24
  derive clamped silently and the entered Days-of-work was lost.)
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
- **New companies start with a fixed per-account default set (owner, 2026-06-25).** `addAccount`
  seeds the four per-account settings — `schedulingMode: 'days'`, `disciplinesEnabled: false`,
  `placeholdersEnabled: false`, `externalEnabled: false` — so a brand-new company opens with
  disciplines OFF, day-granularity scheduling, and placeholders/external HIDDEN. Caller input still
  overrides each; existing/seed/imported accounts (no field) are unchanged (absent reads per each
  pref's documented default — disciplines absent = on, placeholders/external absent = off).

## UI & product
- **Deliberately small (owner, 2026-06-11).** CapacityLens solves ONE problem — a helicopter view of
  who's busy, free, or overworked, week-by-week — for small agencies with few staff and rotating
  freelancers. Owner-confirmed non-goals: budgets/money, timesheets, hour-granularity workflows,
  mobile views (light mobile *affordances* are in scope — next bullet), per-seat/per-feature
  gating. Reject features that add process or granularity.
- **Light mobile affordances, not mobile views (owner, 2026-06-12).** Nav links carry icons;
  the sidebar collapses to an icons-only rail (device-global `capacitylens/sidebar`, default
  collapsed on small screens — `(max-width:767px), (max-height:480px)`) whose rail icons just
  re-open the menu, never navigate (they're `aria-hidden`; the labelled Collapse/Expand toggle
  is the single accessible control); portrait phones get a dismissable session-scoped
  "Best in landscape" hint (`capacitylens/rotateHintDismissed`, shown over the account picker too).
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
  server `openDb` — all idempotent (one per account, never duplicated). **Protected, on every write path:**
  the store throws on renaming/deleting a builtin AND strips `builtin` from public client CRUD, and the
  SERVER (`validateWrite`) rejects a direct API write that would add a SECOND builtin to an account — so the
  one-per-account singleton holds even for a crafted request, not just the UI. **Selectable/bindable everywhere, but HIDDEN from the Clients
  management list (owner, 2026-06-20):** it's a behind-the-scenes data anchor, not a user-managed
  client, so `ClientList` filters out `builtin` rows — but it stays a real, persisted client that is
  still selectable in ProjectForm's client picker, a "Filter by client" option, and a CommandPalette
  Clients entry (all read `useScopedData().clients` directly), and a project under Internal still
  resolves its client label. It can own real projects.
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
- **The schedule re-anchors its left edge to the week start on navigation (zoom / Prev-Next /
  date picker; ALWAYS on).** A zoom click, a Prev/Next pan, and `goToDate` all snap the leftmost
  column to that week's `startOfWeekISO(date, weekStartsOn)` (default Monday), so the weekly view
  always opens on a week boundary; `goToToday` already did. A pure container resize / minimise-
  weekends flip is the exception — it preserves the EXACT left-edge date. `goToDate` does the snap
  in the store (so `Jump to date` shows the snapped Monday); zoom/pan do it in `SchedulerGrid`'s
  geometry re-anchor effect (`panDays(±7)` itself is unchanged).
- **"Snap to week start" is a device-global pref** (`capacitylens/snapToWeekStart`, own key, NOT in
  `AppData`/export), **default on**. When on, FREE horizontal scrolling FLOORS the left edge back to
  the current week's start once it settles (never forward — forward weeks are reached via Prev/Next);
  off = unconstrained scroll. The navigation snap above is independent of it (always on). Both snaps
  round `scrollLeft` to the nearest px before mapping it to a day (`weekStartSnapTarget` in
  `weekSnap.ts`), so a sub-pixel-below scroll position (HiDPI Firefox reports a fractional
  `scrollLeft`) can't floor onto the prior day and jump the view back a week.
- **Theme is device-global** — own key (`capacitylens/theme`), NOT in `AppData`/export. Default
  **light**; `system` follows `matchMedia`; FOUC guard in `index.html`.
- **Utilisation display toggles are device-global** too (`capacitylens/utilizationPrefs`, default all-on).
- **Bar labels carry `Client · Project` context** before the activity name, behind two
  device-global toggles (`capacitylens/barLabelPrefs`, Settings → Allocation bars, default both on);
  missing metadata just skips its part. The popover keeps its own activity-first layout.
- **Time-off draw mode recedes work, spotlights absence (owner, 2026-06-23).** While the toolbar's
  `Time off` draw toggle is active, the grid signals the mode whole-view: work allocation bars drop to a
  flat neutral (the theme-aware `var(--color-muted)` token, which adapts to light/dark) at 20% opacity AND go fully **`inert`** (the HTML attribute — no click/drag/hover-
  popover, removed from the tab order + a11y tree), and existing time-off blocks glow amber. Pointer
  events fall through the inert bars to the lane, so a draw books time off even **over** an existing
  allocation. Driven by `data-draw-mode` on the grid container — one attribute flip → CSS in `index.css`,
  so the memoised lanes/bars don't re-render for the visual; each bar reads the mode from the store to set
  `inert` (one re-render per toggle, a rare deliberate action — the memo still guards the drag hot path).
  Purely visual + interaction state — **no data changes**; switching back to `Work` restores everything.
- **Weekends minimise by default** — device-global `capacitylens/minimiseWeekends` (Settings →
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
- **Schedule visual treatment (2026-06-25 refresh — re-skin only, no geometry change).** The four
  status signals stay in DISTINCT colour families so none reads as another: over-capacity = saturated
  rose (`bg-danger-cell`), weekend/unavailable = a cool recessed band (`--c-weekend` — its own token,
  not the page canvas), today = brand (a 2px `bg-brand` line + an inset-shadow brand cap on the today
  header column), time-off = amber hatch. A future restyle must keep these four distinguishable. Bars
  keep a soft shadow + a light `ring-black/5`, and the FILL stays the exact resolved swatch (the colour
  invariant). The grid measures its container in `useLayoutEffect` (BEFORE paint) so it never flashes
  the `FALLBACK_TIMELINE_WIDTH` geometry on mount / tab-return — don't move that back to `useEffect`.
- **Empty states share one component.** The entity lists AND the empty schedule render the shared
  `EmptyState` (icon + heading + subtext + CTA). The empty schedule sits in a sticky, viewport-width
  `role="row" > role="gridcell"` pinned left — a DIRECT child of the scrolling grid, or the centred card
  drifts off-screen with the horizontal scroll. Its CTA (**Go to Resources** when there are genuinely no
  resources, **Clear filters** when a filter hides everyone) is ALSO the keyboard-focusable element that
  keeps the scrollable grid axe-clean when empty (`scrollable-region-focusable`).
- **List-row actions are icon-only; create buttons carry a leading `+` (owner, 2026-06-25).** The
  shared `common/dialogs` shells own this: row Edit/Delete are the icon-only `EditButton` (pencil,
  ghost) / `DeleteButton` (trash, danger), and every create affordance is an `AddButton` (`+` +
  label) — the scheduler's per-row "Add allocation" already followed it. The Icon glyph is ALWAYS
  decorative (`aria-hidden`); the accessible NAME lives on the button (label text for Add,
  `aria-label`+`title` for Edit/Delete, default "Edit"/"Delete"), so `getByRole('button', {name})`
  stays stable across the text→icon swap. Dialog footer / confirmation CTAs (Save/Cancel/Duplicate,
  the ConfirmDialog + AllocationModal-footer Delete, "Create company") KEEP their text — only
  list-row actions go icon-only. Build new list pages on these shells, not bare `<Button>Edit</Button>`.
- **Undo/redo has visible toolbar buttons + the global ⌘Z / ⌘⇧Z shortcut.** The schedule
  toolbar carries Undo/Redo icon buttons (`undo-button` / `redo-button`, disabled when the
  history stack is empty); the keyboard shortcut stays global in `AppShell`.
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
- **Placeholders are behind a per-account setting, default OFF (owner, 2026-06-25).** Pure VIEW
  pref `placeholdersEnabled` on the **Account** (absent = `false` — note: NOT `?? true` like
  `disciplinesEnabled`), read via `placeholdersEnabledFor(data, activeAccountId)` and toggled in
  Settings → **Placeholders** → *Show placeholders* via `updateAccount`, mirroring
  `disciplinesEnabled` end-to-end (shared `Account` type, `sanitizeImport`, fixtures, server
  `tables.ts` column + CREATE-TABLE spec; carried in export like any account field). OFF
  (out-of-the-box) HIDES placeholders everywhere — the schedule row (so also their bars +
  utilisation contribution), the assignee picker, the command palette, and ResourceList's
  Placeholders section/Add button — but their data is untouched and returns when re-enabled (a
  dataset with placeholders hides, never errors). **Single hide chokepoint:**
  `buildSchedulerModel`'s `resourceVisible` (one filter does rows + bars + utilisation; it keeps its
  boolean param, fed from the per-account selector at the SchedulerGrid call site). Editing an
  allocation already on a hidden placeholder still offers that placeholder in the picker (no silent
  reassign). Any new placeholder surface MUST gate on `placeholdersEnabledFor(data, activeAccountId)`.
  New companies default it OFF (`addAccount` sets the full per-account default set — see *New
  companies start with a fixed per-account default set*).
- **External / 3rd parties are a resource kind (`external`), not a bookable lane (owner, 2026-06-19).**
  Outsourced work: a **company name** (`name`) + optional descriptor (`role`), **assignable to any
  activity** (no project restriction), but **no hours/capacity/utilisation** — allocations carry
  `hoursPerDay: 0` and the scheduler model skips all capacity reads for them. Single **neutral** colour
  (`resolveBarColor` short-circuits their bars, overriding the project-colour rule) in a band **always
  at the schedule bottom**, disciplines on or off; excluded from utilisation averages + the time-off
  picker. Resolves the "third-party line". **Enforced at the write boundary, not just the UI:** the shared
  domain core (store + server) rejects a non-zero load on an external allocation (`assertAllocationRefs`)
  and any time off for an external (`assertResourceExists`); import drops external time off and coerces
  external allocation load to 0 — so bad external data can't persist invisibly via a direct/crafted write.
- **External is behind a per-account setting, default OFF (owner, 2026-06-25).** Like Placeholders:
  a pure VIEW pref `externalEnabled` on the **Account** (absent = `false`, NOT `?? true`), read via
  `externalEnabledFor(data, activeAccountId)` and toggled in Settings → **External** → *Show
  external resources* via `updateAccount` (+ explainer copy, single-sourced in `lib/externalCopy.ts`),
  mirroring `disciplinesEnabled` end-to-end (type, sanitize, fixtures, server column + CREATE-TABLE
  spec; carried in export like any account field). External moved OUT of its old standalone `/external`
  tab INTO the **Resources** tab — a gated **External** section after Placeholders; the `/external`
  route now redirects to `/resources` (no nav link, no command-palette page entry). OFF (out-of-the-box)
  HIDES externals everywhere — the schedule band (and its header doesn't render empty, since the model's
  `rows.length > 0` filter drops the now-empty band group), the assignee picker, the command palette,
  and the Resources-tab section — but their data is untouched and returns when on. **Single hide
  chokepoint:** `buildSchedulerModel`'s `resourceVisible` (keeps its boolean `externalEnabled` param,
  fed from the per-account selector at the SchedulerGrid call site, exactly like `placeholdersEnabled`).
  Editing an allocation already on a hidden external still offers it in the picker (no silent reassign).
  Any new external surface MUST gate on `externalEnabledFor(data, activeAccountId)`. New companies
  default it OFF (the full per-account default set in `addAccount`).
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
  (`capacitylens/fakeSignedIn`, default off, NOT in `AppData`/export) is flipped by clicking the account
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
- **Auth seam is wired but OFF.** `CAPACITYLENS_AUTH=off|password|sso` (Better Auth, sessions + login
  screen): off = byte-for-byte today, no auth tables, no login UI. The server-reported
  `authMode` is the only auth flag — no client-side flag exists.
- **Session ≠ isolation.** Turning `CAPACITYLENS_AUTH` on gates requests, but `accountId` stays
  client-asserted (`ownsRow` is defense-in-depth) until Stage C derives it from the session.
- **`AuthAdapter` is the single session-verify seam (P0.5.8).** `server/src/authAdapter.ts` defines
  the provider-neutral port `AuthAdapter { verifySession(headers): Promise<SessionUser | null> }`;
  `betterAuthAdapter` is the default impl (wraps Better Auth `getSession`). Everything above auth
  (app.ts `requireUser` + `/api/auth/me`) depends ONLY on this port, never Better Auth directly.
  Load-bearing contract: **null = no session → 401; a thrown error = auth-backend failure → 503**
  (never swallowed to null). The OFF guarantee holds — off mode builds no adapter at all.
- **Social sign-in is env-driven + additive (P1.7).** `betterAuth` gets native Google/Microsoft/GitHub
  `socialProviders` from `CAPACITYLENS_<PROVIDER>_CLIENT_ID/_SECRET` — each configured ONLY when both
  are set (fail-closed-absent; Microsoft `tenantId` defaults to `common`). They coexist with the
  generic OIDC (`sso`) plugin; the mode enum + OFF guarantee are untouched.
- **Open self-registration is CLOSED by default (P1.7).** `emailAndPassword.disableSignUp` is ON unless
  `CAPACITYLENS_ALLOW_OPEN_SIGNUP=1` (default off → `POST /api/auth/sign-up/email` returns 400). Self-service
  signup is invite-only by design; that flag is an INTERIM trusted-instance/dev escape until the invite
  flow lands. **Social NEW-USER invite-gating is deferred to P1.9/P1.10** (no invite mechanism yet).
- **CSP:** `object-src`/`base-uri` ship in `index.html`; a full `script-src` policy belongs in
  a host response header, not the app — **not yet added at the host** (Phase 2 edge-hardening
  remainder, see `docs/production-plan.md`).
- **Server-control tables are NOT AppData (P1.1).** Membership (and later invites) live in their
  own schema module (`server/src/controlTables.ts`), mirroring Better Auth's user/session tables.
  `account_members(accountId, userId, role, status, createdAt)` — PK `(accountId, userId)`, indexes
  on `userId` + `accountId`, no FK to AppData — is created idempotently by `ensureControlTables(db)`
  inside `openDb` (after `assertSchemaCurrent`), so EVERY opened DB incl. `:memory:` test DBs has it,
  regardless of auth mode. **Exclusion invariant (load-bearing):** it is deliberately ABSENT from
  the AppData drift path — never in shared `AppData`/`SCOPED_KEYS`, server `TABLES`/`CREATE_ORDER`/
  `SCOPED_ORDER`, `KNOWN_KEYS`, fixtures, `sanitizeImportedRecord`, `loadState`, the generic
  `/api/:entity` CRUD, or import/export — so it can't leak through generic CRUD or the state read.
  Reached ONLY through `upsertMember` / `getMemberRole` / `listMembershipsForUser` (which permissioned
  endpoints, P1.2/P1.5, wrap). Any future control table follows the same rules.
- **`Role` is single-sourced in shared (P1.1).** `shared/src/domain/access.ts` exports
  `Role = 'owner' | 'admin' | 'editor' | 'viewer'` (owner = all incl. ownership-transfer; admin =
  manage members/invites + purge; editor = edit; viewer = read-only) — pure domain, consumed by the
  server's membership table now and by P1.3's pure `can(role, action)` + the client later (P1.3 ADDS
  `Action`/`can`/`canSeeTimeOffNote` to this same file). Writes validate the role against this set
  and throw on an unknown role — never silently coerce an access level.
- **`can(role, action)` is the single pure access authority (P1.3).** `shared/src/domain/access.ts`
  exports `Action = read | write | manageMembers | manageInvites | purge | transferOwnership` and a
  PURE `can(role, action)` (no I/O, no session, no Date/random) — the ONE place the matrix is
  encoded, reused by the server (P1.5 `requirePermission`) AND the client (P1.12 affordances) so the
  two can't drift. Matrix (Decisions): `read` = any member, `write` = editor+, `manageMembers` /
  `manageInvites` / `purge` = admin+, `transferOwnership` = owner. Encoded as a named role-rank
  (`viewer<editor<admin<owner`) + a per-action minimum-tier table `satisfies Record<Action, Role>`
  (exhaustive over `Action` at compile time; fail-closed on an unknown role/action). The field-level
  `canSeeTimeOffNote(role)` (owner/admin only) is kept SEPARATE — it's a field-visibility rule
  (redacts the time-off `note` server-side in P1.6), not a route Action.
- **`TenantStore` is the scoped-read/write swap point (P1.4).** `server/src/tenantStore.ts` —
  `interface TenantStore { readSlice(accountId): AppData; write(accountId, next): void }` +
  `sqliteTenantStore(db)`, the SINGLE shared-SQLite implementation and the documented swap point: a
  future per-agency-DB / per-instance / Postgres backend swaps HERE, behind the interface, with no
  route change. `readSlice(db, accountId)` (db.ts) is the per-account scoped read — `WHERE accountId
  = ?` on all 8 scoped tables + accounts-by-id, every key present, unknown id → empty slice (no
  throw); the no-cross-tenant invariant (no unpredicated query) lives at this layer. `write` thinly
  wraps `replaceAccountSlice` (NOT yet routed into /api/batch or per-entity writes — that's P1.5).
- **The two read endpoints + the OFF-vs-auth-on gate posture (P1.4).** `GET /api/accounts` (OFF =
  ALL account `{id,name}` summaries, NO membership gate — branched before membership for the OFF
  guarantee; auth-on = `listAccounts`). `GET /api/state?accountId=` returns `store.readSlice(id)`
  (OFF = no gate; auth-on = thin membership-existence guard: `resolveRole === null` → 403, so it
  can't cross-tenant-read — the richer per-action `can()` gate is P1.5). **The no-arg `GET /api/state`
  whole read is RETAINED** (legacy) for the OFF client AND the not-yet-migrated auth-on client + e2e
  until P1.13 migrates the client to per-account hydration; remove it then. KNOWN GAP: in auth-on this
  no-arg whole read currently returns ALL tenants to any authenticated user (a cross-tenant
  whole-read) — closing it was attempted then reverted because the un-migrated client still hydrates
  via no-arg `/api/state`; it closes at P1.13 (client passes accountId) + P1.5 (requirePermission).
  Auth-on is not the default/shipped posture.
- **`requirePermission` — the auth-on route gate (P1.5).** An `authorize(req, reply, accountId,
  action)` seam in `buildApp` (app.ts): **OFF = NO-OP allow-all on its FIRST line** (resolveRole/can
  never run — `req.user` is DEMO_USER; the #1 invariant), auth-on = `resolveRole` → null (non-member)
  or `can(role, action)` false (low tier) → 403 `{ error: 'Forbidden.' }` (no 401/503 — requireUser
  handled those upstream). GATED: `GET /api/state?accountId=` (read), scoped `POST/PUT/PATCH/DELETE
  /api/:entity` + `POST /api/import` (write, each via the accountId it already derives), and `POST
  /api/batch` (PRE-SCAN before the tx — a mixed allowed+denied-account batch is rejected WHOLE, one
  403, NO partial write). All prior ownsRow/immutability/404/400 guards stay. Cross-tenant scoped
  read AND write are now 403 in auth-on. **Account hard-delete is gated `'purge'` (admin+)** on BOTH
  vectors — the direct `DELETE /api/accounts/:id` route AND the batch `{method:'DELETE',table:'accounts'}`
  op (the client's delete-company path) — resolving the caller's role against the account's OWN id;
  a delete CASCADES (total tenant destruction), so the CREATE exemption does not extend to it. Account
  `POST /api/accounts` (and batch PUT on accounts) **stays OPEN** (new-user onboarding has no membership
  and there is no `createAccount` Action). This is an interim gate pending P2.5/P2.6's full
  archive→soft-delete→purge lifecycle. **DEFERRED (untouched):** the no-arg whole `/api/state` read
  (→ P1.13), and `manageMembers`/`manageInvites`/`transferOwnership` (no routes yet — matrix-only in
  access.test.ts).
- **Time-off `note` is owner/admin-only, redacted SERVER-SIDE (P1.6).** `readSlice` takes a REQUIRED
  `{ includeTimeOffNote }` (no silent default — every caller decides); `false` STRIPS the `note` key
  from every time-off row before it leaves the server, so it's never serialized for an Editor/Viewer.
  `GET /api/state?accountId=` computes it as `authMode === 'off' || canSeeTimeOffNote(role)` (OFF =
  trusted-local include; auth-on: owner/admin include, editor/viewer omit) AFTER `authorize('read')`.
  The no-arg whole `/api/state` read is left UNredacted (deferred P1.13 — moot while it already
  returns everything to any authed user). `app.authz.test.ts` asserts the sentinel note is absent from
  the raw response BODY for editor/viewer (proof of server-side redaction).
- **API security headers (@fastify/helmet, P0.5.3):** the Fastify server emits baseline
  headers ON by default — `nosniff`, a strict minimal CSP for this JSON-only API
  (`default-src`/`connect-src`/`base-uri 'self'`, `frame-ancestors 'none'`, `object-src 'none'`),
  `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY`. **HSTS is the one header gated
  OFF by default** behind `AppOptions.https` / `CAPACITYLENS_HTTPS=1` — HSTS is invalid/harmful
  over plain HTTP, and this server usually runs HTTP behind a TLS-terminating proxy, so the
  operator opts in only once real HTTPS fronts the public origin.

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
- **No GitHub Actions CI — the local green gate is the enforcement mechanism.** CI was
  deliberately removed (`5b324020`, "run the gate locally instead") and the gate runs on demand.
  The CapacityLens open-source plan's **P0.6 ("Restore CI")** wants a `.github/workflows/ci.yml`
  back for the *public* repo so external PRs are checked — but that is **parked pending an explicit
  go-ahead**: re-adding it would resume ~6-min Actions runs on every push/PR, undoing the recent
  deliberate removal and contradicting the standing "no Actions CI, merge via local gate" posture
  the build loop runs under. Revisit when ready for the public launch (then re-add the workflow and
  switch the loop's merge step to wait on required checks).
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
  `CAPACITYLENS_VITE_ONLY` for `e2e:browsers`, or either single-engine `*_ONLY` flag, trims the `webServer`
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
