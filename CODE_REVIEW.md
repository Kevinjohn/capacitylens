# Floaty — End-to-end code review (pre-first-push)

Max-effort, recall-oriented review of the **entire** tree (~16.5k LOC): web app (`src/`),
pure domain core (`shared/`), optional `node:sqlite` server (`server/`). Method: 14 parallel
subsystem finders + a dedicated cross-boundary seam finder, deduped, then the crown-jewel
findings re-confirmed by reading source directly (`transfer.ts`, `mutations.ts`, server
`app.ts`/`validate.ts`, `persist.ts`, `useStore.ts`, `migrate.ts`, `LocalStorageAdapter.ts`,
`capacity.ts`, `ui.tsx`, router/shell), plus a gap sweep (returned empty).

**Mode tags:** `[default]` hits the local-first app everyone runs first. `[server]` only
when the optional API is enabled (`VITE_FLOATY_API=…`, off by default) — triage below default-mode bugs.

The data/date/layout core is genuinely strong — see "Verified clean" at the bottom. The
findings cluster in **import/data-safety**, **form/gesture validation gaps**, and
**server-vs-client parity**.

---

## 🔁 Round 2 — fresh full re-review of the post-fix tree (2026-06-01)

A second max-effort, recall-oriented pass over the **entire** tree *after* the Round-1 fixes
landed (incl. the 51 uncommitted files). Method: 9 independent finders (2 deep readers each on
the two hottest clusters — scheduler geometry/date/gesture and sync/server — plus single deep
readers on store/import, domain, forms; cross-file regression tracer; cleanup/altitude), then
**one verifier per surviving candidate** (9/9 returned CONFIRMED), the highest-severity
import-cluster claim re-confirmed by reading source directly (`transfer.ts`, `mutations.ts`,
`useStore.ts`, `integrity.ts`, `ImportExport.tsx`), and a gap sweep (found 1 new). **14 confirmed
findings.** Nothing here is fixed yet — this round is review-only.

Ranked by **severity-of-kind**, with `[default]` items first (every user hits these) and a
separated `[server]` block at the end — gated behind the off-by-default API (`VITE_FLOATY_API`),
so they triage *below* default-mode bugs for the first push despite being severe within server mode.

| # | Sev | Mode | File:line | Finding → failure |
|---|-----|------|-----------|-------------------|
| 1 | **Crash** | default | `scheduler/AllocationModal.tsx:318,337` | "Days over/of work" field is `min:1` with **no max**, and the end-date hint calls `format(parseDate(effEndDate))` unguarded. A large value (~2.9M+ days, empirically confirmed) yields a 5-digit-year string `parseDate` can't round-trip → `format(Invalid Date)` throws `RangeError` mid-render → router boundary replaces the whole scheduler. **Fix: guard `effEndDate` validity before formatting (and cap the field).** |
| 2 | **Data loss** | default | `ImportExport.tsx:65` | When an import drops every record (`imported===0`) the store correctly skips `mutate` (no wipe), but the toast still says "**Press ⌘Z to undo**". Following it pops the user's *prior unrelated* edit. Trigger: import a Floaty-shaped file whose rows all dangle (e.g. allocations-only export into an empty company). **Fix: only show the undo hint when `imported>0`.** |
| 3 | **Data loss** | default | `AppShell.tsx:57` | Global ⌘Z/⌘⇧Z suppresses only when focus is in INPUT/TEXTAREA/contentEditable, never checking `dirtyForm` (unlike the sibling `beforeunload` guard at L38). AllocationModal sets **no** `autoFocus`, so on open focus sits on the close button / Assignee `<select>` — a non-text control — so ⌘Z there runs `undo()` against the data behind the open, unsaved form; Save then writes stale local state over the reverted data. **Fix: bail undo/redo when `dirtyForm`.** |
| 4 | **Wrong UI** | default | `scheduler/AllocationBar.tsx:225` | Drag **preview** is a raw calendar pixel shift; **commit** runs `applyGesture`→`endDateForWorkingDays`/`snapToWorkingDay`. For a Mon–Fri resource any move/resize crossing a weekend makes the bar **jump** on pointer-release vs what was previewed. **Fix: preview through the same working-day snap.** |
| 5 | **Bad data** | default | `scheduler/AllocationBar.tsx:169,188` | Cross-row **reassign** computes dates with the **source** resource's `workingDays` but writes them to the **target**. Dropping a Mon–Fri bar onto a Tue–Sat resource commits dates on the target's non-working days. **Fix: recompute against the target's working days on reassign.** |
| 6 | **Lost edit** | default | `hooks/useDragResize.ts:33` | Gesture listeners live on `document`, removed on unmount; no pointer capture / scroll-lock. A vertical scroll mid-drag virtualizes the dragged row out → AllocationBar unmounts → listeners detach → pending `pointerup` never commits. **Fix: pin the dragged row during the gesture.** |
| 7 | **Wrong filter** | default | `scheduler/SchedulerToolbar.tsx:46` | The 180ms search-debounce timer is cancelled only by Clear, not on an external `filters.search` reset (account switch). A pending `setFilters({search:'old'})` fires after the switch, clobbers the cleared value, and the reconcile re-applies the stale term so it sticks. **Fix: cancel the timer in a `useEffect` keyed on `filters.search`.** |
| 8 | **Capacity** | default | `shared/lib/sanitizeImport.ts:55` | `safeWorkingDays` filters by range but never **de-dupes**, so `[1,1,1,1,1,1,1]` passes with length 7. `isWeekendAware` keys on `length<7` and `endDateForWorkingDays` on `length>=7`, so a Monday-only resource imports as a 7-day worker. **Fix: dedupe to a Set before the length checks.** |
| 9 | **Validator bypass** | default | `shared/lib/strings.ts:19` | Disallowed set covers `Extended_Pictographic/So/Cc/Cf/Cs/Co/Cn` but omits Marks, so emoji VS-16 **U+FE0F** (Mn) and keycap **U+20E3** (Me) pass both form rejection and import stripping — `1️⃣` lands in names/notes. **Fix: add `\p{Me}` + target U+FE0F (not a blanket `\p{Mn}`, which strips decomposed accents).** |
| 10 | **Silent drop** | default | `shared/domain/mutations.ts:170` | `remapAndValidateImport` uses a **single global** `idMap` keyed only on source id across all tables. A corrupt cross-table id collision resolves every FK to the first table in `SCOPED_KEYS`; a record referencing the other is misrouted and dropped with its subtree (PK collisions are separately handled — this is the **FK-resolution** gap). Crafted input only. **Fix: key the id map per-table.** |
| 11 | **Latent guard** | default | `store/useStore.ts:472` | `updateTask` validates the **raw patch** (unlike `updateAllocation`, which validates the merged row): a `phaseId`-only patch is wrongly rejected; a `projectId`-only patch is wrongly accepted into a stale cross-project state the server 400s on sync. Masked today (TaskForm sends both). **Fix: merge over `existing` before asserting.** |
| 12 | **Defense gap** | default | `store/useStore.ts:392,400` | `addResource`/`updateResource` never clamp `workingHoursPerDay` (allocations clamp `hoursPerDay`). The store claims to be "the last line," but a non-form / pre-blur-paste write of `NaN`/`1e9` persists → NaN/over-24h capacity geometry. **Fix: clamp on the resource write path too.** |
| 13 | **Integrity** | server | `server/index.ts:31` | Boot seeding gates on `isEmpty()` not the persistent `isInitialized()` marker (which `/api/meta` uses). Deletes never clear `_meta`, so a user who empties their data gets the demo dataset re-seeded on the next restart — the exact bug `_meta` exists to prevent. **Fix: gate the boot seed on `!isInitialized(db)`.** |
| 14 | **Data loss** | server | `data/ServerSyncAdapter.ts:164` | `drain()` awaits each op sequentially; on a `pagehide` flush only the **first** op's fetch dispatches before teardown — ops 2..N never send despite `keepalive`. A cascade delete (many ops) right before closing the tab loses all but the first, irrecoverable in server mode. **Fix: dispatch the unload flush concurrently / batch / `sendBeacon`.** |

**Lower-severity / by-design-adjacent / cleanup** (real, but triaged below the 14):
- `[default]` `gestureMath.ts` resize-start snaps the edge to a working day then clamps `start=endDate`, which can land on a non-working end day and zero the days-mode span → `volumePreservingHours` silently keeps old hours (narrow edge of the weekend-gesture cluster).
- `[default]` `AllocationBar.tsx` at max zoom-out (`dayWidth≈2·barInset`), `insetWidth=max(1,width−2·barInset)` collapses a single-day bar to a ~1px sliver offset right of its cell — short allocations become near-invisible/unclickable.
- `[server]` `server/validate.ts` `sanitizeWrite` repairs `accounts` color+name but never clamps the `schedulingMode` enum — a direct `POST/PUT /api/accounts` persists a junk mode (server claims to be the integrity boundary for direct writes).
- `[server]` `data/persist.ts` retry budget caps at 5 with no localStorage fallback; a persistent server failure that exhausts retries strands the in-memory delta if the user reloads before the next edit (design-acknowledged).
- `[cleanup]` `server/db.ts` `insertAll` runs `markInitialized` (prepared `_meta` upsert) **per row** — a seed/import re-marks N times; do it once.
- `[cleanup/altitude]` the cross-account ownership check is hand-rolled in three handlers (`app.ts` PUT/PATCH/DELETE) — a new mutating endpoint can silently omit it; extract one `assertSameAccount`.
- `[cleanup]` `clampHoursPerDay` (store) and `clampHours` (sanitizeImport) are two impls that already **disagree on negative input**; unify next to `MAX_HOURS_PER_DAY`.
- `[cleanup/efficiency]` `capacity.ts` calls `isWorkingDay(resource,day)` then `availableHoursOnDay` (which calls it again) for every day in the window — hoist once.

**Verified clean (refuted / sound):** the import 0-record **wipe** guard holds — `parseData` throws on total 0, and `imported===0` refuses without mutate on *both* store and server, so an accounts-only/empty-scoped file does **not** wipe the active slice (Finder 6's "silent wipe" → **refuted**). `UPSERT_ORDER` enumerates all 9 entity arrays (no silently-unsynced table) and `applyOps` drops no `AppData` field; `drain` partial-failure is "stranded-until-next-save," not lost; undo/redo timing + account-switch history clearing are sound; `replaceAccountSlice`/`migrateSchema` are transactional/additive; `migrate.ts` version handling, date-math NaN guards, `windowFromLayout` off-by-one, and `capacityAdvisory` self-exclusion are all correct.

## ✅ Round 2 Resolution — all 14 findings + 8 addendum items fixed

Every Round-2 finding **and** every lower-severity/cleanup item above is fixed, each with a
regression test. Final suite: **root 430 · shared 111 · server 40 · e2e 89 = 670** green,
type-check + lint clean. Root coverage rose on every metric (statements 87.68%→**88.44%**,
branches 77.58%→**78.47%**, functions 87.95%→**88.2%**, lines 90.22%→**91%**).

**The 14 findings** — `#1` cap the span in `endDateForSpan` (new `MAX_SPAN_DAYS`) + guard the
modal hint's `format()` + field `max`; `#2` only advertise ⌘Z when `imported>0` (else an error
notice); `#3` `AppShell` ⌘Z bails on `dirtyForm`; `#4` the drag preview now runs the same
`applyGesture` and reconstructs pixels via `differenceInCalendarDays`/`daysInclusive` (no jump
on release); `#5` `onCommit` resolves the reassign target first and snaps dates against **its**
working week (`computeFor`); `#6` a transient store `draggingAllocationId` pins the row by
freezing the scroll input while a drag is live (and is released on commit/cancel/unmount);
`#7` the debounce timer is cancelled on any external `filters.search` **or** tenant change;
`#8` `safeWorkingDays` de-dupes; `#9` the disallowed-char set adds `\p{Me}` + the
variation-selector ranges (keeps decomposed accents); `#10` per-table `idMap`; `#11`
`updateTask` validates the merged row; `#12` resource hours clamped (>0) via the shared
`clampWorkingHoursPerDay`; `#13` boot seed gates on `seedIfUninitialized` (the `_meta` marker);
`#14` an **unload-only** dispatch-all flush (`saveAll(data,{unload})`) — `drain` stays
sequential/ordered for the normal path (a blanket-concurrent drain would FK-storm the
server-mode import).

**Addendum** — `A` gesture over-drag clamp snaps to a working day; `B` bar inset capped to
`width/3`; `C` `schedulingMode` clamped on direct account writes (`SCHEDULING_MODES`); `D`
`online`/visible re-attempt of a stranded write (gated on a real prior failure); `E`
`markInitialized` once per bulk insert; `F` one `ownsRow` tenant predicate across PUT/PATCH/
DELETE; `G` one shared allocation/resource clamp pair (store + import can't drift); `H`
hoisted the per-day `isWorkingDay`/`isOnTimeOff` in `capacityAdvisory`.

Two corrections caught mid-fix and resolved: `#14` was first written as a blanket-concurrent
`drain` — reverted to **unload-only** after tracing that concurrent dispatch would cascade-400
the normal server-mode import (FK tree fanned across the connection pool); and the unload flush
was made **conditional on `pending`** after an e2e round-trip caught an unconditional pagehide
write resurrecting data after an external `localStorage.clear()`.

**Honest residual on `#14`:** the unload flush covers the *debounced-but-unflushed* window
(0–300 ms after an edit). A `[server]`-mode tab close *during* an already-in-flight sequential
`drain()` can still drop ops after the first (they're behind the `await` and never initiate).
This is pre-existing and strictly improved vs. before; closing it without re-introducing the
localStorage resurrect would require the local adapter to no-op an unchanged-blob write — added
complexity not worth it for an off-by-default mode. Documented, not silently dropped.

---

## ✅ Round 1 Resolution — all 15 findings + 10 runners-up fixed

Every item below was fixed with a regression test. Suite after the work: **root 416 ·
shared 104 · server 38 · e2e 89 = 647 tests green** (was 498 unit/component/integration +
the e2e suite), type-check + lint clean. Root coverage rose on every metric vs. the
pre-fix baseline (measured by stashing the changes): statements 86.91%→**87.68%**, branches
76.51%→**77.58%**, functions 87.77%→**87.95%**, lines 89.27%→**90.22%**.

**#5, R3, and R10 — completed in full (these three went a step further):**
- **#5** scopes the **DELETE** as well as PUT/PATCH: the sync sends the owning account
  (`?accountId=…`, from the pre-delete snapshot) for every scoped delete, and the server
  refuses (404) a delete of another account's row. The two are **not** equal strength,
  though: PUT/PATCH is a hard, unbypassable invariant (`existing.accountId !==
  body.accountId → 409`), whereas the DELETE guard is **opt-in/defense-in-depth** — it
  only checks when the caller supplies the param, and the account is *asserted by the
  client*, not derived from a session. It reaches `findOwned` parity (catches an honest
  client bug); **real tenant isolation still requires the account to come from the
  authenticated session, not a client-supplied param, once auth lands.**
- **R3** advances `lastSynced` by exactly the ops that LANDED (`applyOps`), so a
  permanently-failing row is fully isolated: only it stays in the next diff and retries,
  every other change is marked synced and never replays — no growing-delta replay.
- **R10** **repairs** an unpadded-but-valid imported date (`2026-6-1` → `2026-06-01`) so
  the record is kept instead of dropped, on top of the locked write-boundary guard.

| # | Fix | Key files | Test |
|---|-----|-----------|------|
| 1 | Reject 0-record import (parse + apply sites) | `transfer.ts`, `useStore.importData`, server `/api/import` | transfer/import-hardening/crud + e2e |
| 2 | Duplicate source-id → distinct fresh ids | `mutations.ts` | mutations.test |
| 3 | Reject empty `workingDays` (form + store) | `validation.ts`, `ResourceForm`, `useStore` | validation/ResourceForm/crud |
| 4 | Router `errorElement` → branded recovery | `router.tsx`, `ErrorBoundary` (`RouteError`) | ErrorBoundary.test |
| 5 | Server rejects cross-account re-home (PUT/PATCH) **+ scoped DELETE** | `app.ts`, `validate.ts`, `ServerSyncAdapter` | app + ServerSyncAdapter.test |
| 6 | Clamp `hoursPerDay` ≤ 24 (drag + store) | `AllocationBar`, `useStore`, `entities.MAX_HOURS_PER_DAY` | crud.test |
| 7 | Weekend-aware resize snaps off non-working days | `gestureMath.ts` | gestureMath.test |
| 8 | `dimmed` uses hideTentative-aware predicate | `schedulerModel.ts` | schedulerModel.test |
| 9 | Defer `revokeObjectURL` + append anchor | `lib/download.ts` (3 call sites) | download/ImportExport |
| 10 | Unload flush uses `keepalive` | `ServerSyncAdapter` | ServerSyncAdapter.test |
| 11 | `hasExisting` throw kept inside bootstrap guard | `persist.ts` | persist.test |
| 12 | Delete dialog opts out of dirty-guard | `ui.Modal` (`guardDirty`), `DeleteCompanyDialog` | DeleteCompanyDialog.test |
| 13 | ColorField swallows only backdrop clicks | `ui.ColorField` | ui.test |
| 14 | Damaged blob → recovery (not silent coerce) | `LocalStorageAdapter` | LocalStorageAdapter.test |
| 15 | `timeOffDays` counts working days only | `capacity.ts` | capacity.test |
| R1 | Sub-threshold cancel notifies consumer | `useDragResize`, `AllocationBar` | useDragResize.test |
| R2 | Import stamps fresh timestamps | `mutations.ts` | mutations/sharedCore |
| R3 | Drain attempts every op **+ advances past landed ops** (poison isolated) | `ServerSyncAdapter` (`applyOps`) | ServerSyncAdapter.test |
| R4 | `/api/meta` uses a persistent init marker | server `db.ts`/`app.ts`/`tables.ts` | app.test |
| R5 | Task↔phase coherence + cascade unbind | `mutations.ts`, `integrity.ts` | mutations/integrity |
| R6 | `safeColor` trims; color rejects overlong hex | `sanitizeImport.ts`, `color.ts` | sanitizeImport/color |
| R7 | Generic add-missing-column migration | server `db.ts` | db.migrate.test |
| R8 | `upsertRow` preserves immutable `createdAt` | server `db.ts` | app.test |
| R9 | Modal honours `data-autofocus` | `ui.tsx` | DeleteCompanyDialog.test |
| R10 | Import **repairs** unpadded dates (kept, not dropped) + guard locked | `sanitizeImport.ts`, `dateMath` | sanitizeImport/mutations/integrity |

---

## Findings (most severe first)

### 1. Empty/empty-shaped import file silently wipes the active company `[default · DATA LOSS]`
- **Where:** `shared/src/data/transfer.ts:26` (`looksLikeFloaty`) → `src/store/useStore.ts:322` (`importData`) → `shared/src/domain/mutations.ts:234` (slice replace).
- **What:** `looksLikeFloaty` only checks *shape* — `KNOWN_KEYS.some(k => Array.isArray(candidate[k]))`. A file like `{"accounts":[]}` or a truncated backup with all-empty arrays **passes the guard whose own comment says it exists to prevent a silent wipe**, migrates to 0 records, and `remapAndValidateImport` replaces the active account's slice with nothing.
- **Trigger:** Import a truncated/empty/pre-data export. The active company's disciplines/resources/projects/allocations vanish. Recoverable only via ⌘Z (lost on reload/persist).
- **Fix:** Reject an import that nets 0 records (or whose scoped arrays are all empty) before replacing the slice; or require explicit confirmation showing the non-zero delta.

### 2. Duplicate source-id in an imported file collapses two records onto one id `[default/import · CORRUPTION]`
- **Where:** `shared/src/domain/mutations.ts:156` and `:171` (`remapAndValidateImport`).
- **What:** `idMap.set(e.id, newId())` overwrites on a duplicate source id, so at `:171` both records resolve to the **same** fresh id via `idMap.get(e.id)`. Two rows land with an identical primary key. Because the store matches entities by id **globally** (`updateById`/cascade scan all accounts), editing or deleting one silently hits both, and any FK pointing at that source id is ambiguous.
- **Trigger:** Import a hand-edited/corrupt/concatenated file containing two records with the same `id`. (`importHardening.test.ts` only covers the id-*less* case.)
- **Fix:** Detect a collision in `idMap` (or always assign per-record fresh ids and remap FKs through a first-seen map) and either fail the import or treat duplicates as distinct.

### 3. A resource can be saved with zero working days → permanently broken capacity `[default/UI · HIGH]`
- **Where:** `src/lib/validation.ts` (no working-days validator), `src/components/resources/ResourceForm.tsx:63` (no guard), `src/components/common/ui.tsx:665` (`WeekdayPicker.toggle`, no min-1), `src/store/useStore.ts:377/384` (`addResource`/`updateResource` assert refs only).
- **What:** Deselecting every weekday yields `workingDays:[]`, which persists. `availableHoursOnDay` (`capacity.ts:24`) then returns 0 every day, so the resource reads as over-allocated on every allocated day and contributes 0 capacity. Note the asymmetry: the **import** path repairs `[]→[1..5]` (`sanitizeImport.ts:40`), but the **form** path has no equivalent guard and no store backstop.
- **Trigger:** Edit a resource, toggle all weekday buttons off, Save.
- **Fix:** Validate `workingDays.length > 0` in the form (and ideally assert it in `addResource`/`updateResource` so every write path is covered).

### 4. The app's only crash-recovery screen is unreachable `[all modes · HIGH]`
- **Where:** `src/main.tsx:39` wraps `<RouterProvider>` in the custom `<ErrorBoundary>`; `src/router.tsx:18` uses `createBrowserRouter` (RR v7 **data router**) with no `errorElement` on any route.
- **What:** A RR v7 data router catches render/loader errors in its **own** internal per-route boundary and renders RR's default "Unexpected Application Error" page — it never rethrows to a React ancestor. So any in-tree crash (SchedulerView, a list page, AllocationModal, AppShell) shows RR's bland page; the branded "Something went wrong / Reload" recovery screen never appears.
- **Fix:** Add an `errorElement`/`ErrorBoundary` route element (RR v7 style) — e.g. an `errorElement` on the root route rendering the existing recovery UI.

### 5. Server write path doesn't enforce account ownership/immutability the client does `[server · CROSS-TENANT INTEGRITY, latent]`
- **Where:** `server/src/app.ts:140` (PATCH), `:124` (PUT), `:152` (DELETE); `server/src/validate.ts:61-68`. Contrast `shared/src/domain/mutations.ts:43` (`findOwned` throws on a cross-account target).
- **What:** `validateWrite` for `clients`/`disciplines`/`accounts` returns early with **no** checks, and for scoped tables it validates refs against the **body's** `accountId`, never asserting `merged.accountId === existing.accountId`. So a crafted `PATCH /api/clients/c1 {"accountId":"B"}` **re-homes** c1 into account B, leaving c1's projects (still in A) referencing a client outside their account — a cross-account dangling ref the client can never produce. `DELETE` is likewise unscoped (deletes any id globally + DB cascade). Today this is direct-API-only (the phase has **no auth by design**), but it becomes a tenant-isolation vulnerability the moment auth lands.
- **Fix:** In PUT/PATCH/DELETE, load the stored row and reject when `existing.accountId !== row.accountId` (and 404 a cross-account delete) — the server analog of `findOwned`.

### 6. Days-mode resize can persist an unbounded `hoursPerDay` `[default/UI · MEDIUM]`
- **Where:** `src/components/scheduler/AllocationBar.tsx:172` (`volumePreservingHours`); `src/store/useStore.ts:471` (`updateAllocation` validates refs + range, **not** hours).
- **What:** Resizing rescales hours by the new span; dragging the end handle **past the start** clamps the span to 1 day, so `volume / 1` inflates `hoursPerDay` (e.g. 80 h/day) with no upper bound, and nothing validates it on commit.
- **Trigger:** A 10-day @ 8h days-mode allocation; drag the end handle far left past the start → ~80 h/day persisted.
- **Fix:** Clamp/validate `hoursPerDay` (e.g. ≤ 24) on commit and in `updateAllocation`/`addAllocation`.

### 7. Resize handle ignores weekend-aware day-skipping `[default/UI · MEDIUM]`
- **Where:** `src/lib/gestureMath.ts:55` (resize-start) and `:59` (resize-end).
- **What:** Both advance the edge with a plain `addDaysISO`, unlike the `move` branch (`:46-52`) which preserves the working-day count across weekends. Resizing a weekend-aware allocation drops a non-working day inside `[start,end]`; in days mode the recomputed working-day span doesn't change, so calendar end and hours/day silently desync.
- **Fix:** Apply the same weekend-aware advance used by `move` to the resize edges when the allocation is weekend-aware.

### 8. Hide-tentative filter renders a full-opacity, zero-bar "ghost" row `[default · MEDIUM]`
- **Where:** `src/components/scheduler/schedulerModel.ts:141` (`dimmed` via `matchesProjectClient`) vs `:142` (`visibleAllocs` via `allocVisible`).
- **What:** `dimmed` ignores `hideTentative` while the bars apply it. A resource whose only project-matching allocation is **tentative** is classified matched (`dimmed=false`), so it survives the `showUnmatched:false` filter yet renders with no bars — reading as "actively staffed" while showing nothing and hiding its real load.
- **Trigger:** Filter `{projectId, hideTentative:true, showUnmatched:false}` with a resource whose only matching allocation is tentative.
- **Fix:** Compute `dimmed` against the same visibility predicate the bars use (apply `hideTentative`).

### 9. Exports can produce an empty file — including the "Export first" backup before delete `[default · DATA-SAFETY]`
- **Where:** `src/components/ImportExport.tsx:47`, `src/components/accounts/DeleteCompanyDialog.tsx:35`, `src/components/StorageRecovery.tsx:20`.
- **What:** `URL.revokeObjectURL(url)` is called synchronously right after `a.click()` on a never-appended anchor, racing the browser's async download; on some browsers (notably Firefox) the saved file is empty or the download silently fails. Most damaging for the "Export first" safety step taken right before an irreversible company delete.
- **Fix:** Revoke the object URL in a `setTimeout`/after the download tick (and/or append the anchor to the DOM before clicking).

### 10. Server: the last edit is lost on tab close `[server · DATA LOSS]`
- **Where:** `src/data/persist.ts:92` (`flush` on `pagehide`/`visibilitychange`); `src/data/ServerSyncAdapter.ts:111` (`saveAll` → `fetch`, no `keepalive`).
- **What:** `flush()` calls `save()` which fires the async `saveAll` and returns immediately — it can't await. The comment concedes the flush "is safe" only because "localStorage writes are synchronous." `ServerSyncAdapter` issues plain `fetch` with no `keepalive`/`sendBeacon`, so the browser cancels the in-flight request as the page unloads, and there is no localStorage fallback in server mode.
- **Fix:** Use `fetch(..., { keepalive: true })` (or `navigator.sendBeacon`) for the unload flush in `ServerSyncAdapter`.

### 11. Server: a `/api/meta` blip after a successful load discards the data and bricks saving `[server · DATA DISCARD]`
- **Where:** `src/data/persist.ts:155` (`await adapter.hasExisting()` sits **outside** the `loadAll` try/catch at `:135-153`); `src/data/ServerSyncAdapter.ts:106` (throws on non-OK `/api/meta`) vs `src/data/LocalStorageAdapter.ts:30` (swallows → false).
- **What:** When `/api/state` succeeds but `/api/meta` then fails transiently, `hasExisting()` throws, bootstrap rejects before `replaceAll(initial)` (`:159`) and before `attachPersistence` (`:172`). The successfully-loaded data is dropped, persistence is never attached, and `main.tsx`'s `.catch` shows an empty app with a misleading "changes aren't saving" banner (not even the connection-error retry screen).
- **Fix:** Move `hasExisting()` inside the same try/catch (route a throw to `connectionError`), or make `ServerSyncAdapter.hasExisting` tolerant like the local adapter.

### 12. Delete-company dialog refuses to close once you start typing the confirmation `[default · UX]`
- **Where:** `src/components/accounts/DeleteCompanyDialog.tsx` (type-to-confirm input inside `Modal`); `src/components/common/ui.tsx:89` (`input` listener → `setDirty`) and `:104-110` (`requestClose` blocks while dirty).
- **What:** Typing the company name to confirm fires native `input` events that flip the Modal's `dirty` flag, so Escape/backdrop are refused with "unsaved changes — use Cancel or **Save** to close" — but this dialog has only Cancel/Delete. The generic unsaved-changes guard misfires on a confirmation dialog. (Cancel still works, so it's not a hard lock.)
- **Fix:** Let the delete dialog opt out of the dirty-guard (it has no savable form state), or exclude a confirm-only field from dirtiness.

### 13. An open ColorField popup swallows the first click on other controls `[default · UX, by-design trade-off]`
- **Where:** `src/components/common/ui.tsx:576-584` (`onDown` capture-phase `stopPropagation`).
- **What:** While the swatch popup is open, a mousedown anywhere outside it is consumed at document-capture (to dismiss only the popup, not the Modal — see the comment at `:570-573`), so clicking another control (text input/select) closes the popup but the click doesn't land; the user must click again. This is a deliberate trade-off, called out here as a UX rough edge, not a defect.
- **Fix (optional):** Only `stopPropagation` when the target is the Modal backdrop, letting clicks on in-form controls through.

### 14. Local: a parseable-but-damaged store blob silently drops tables, then overwrites the recoverable bytes `[default · RECOVERY GAP, narrow]`
- **Where:** `src/data/LocalStorageAdapter.ts:23` (only `JSON.parse`/`migrate` *throws* count as corrupt); `shared/src/data/migrate.ts:11` (`asArray` coerces any non-array table to `[]`).
- **What:** A valid-JSON blob whose table is the wrong type (e.g. `clients` is a string/object) loads **without** a `LoadError`: `normalize` coerces it to `[]`. So `StorageRecovery` (which offers "export raw" before reset) is bypassed, autosave attaches, and the next write overwrites the recoverable bytes. The lenient coercion is intentional for tolerating slightly-off files; the downside is the lost recovery path. Narrow trigger (external corruption/version skew — a normal save never writes a non-array table).
- **Fix:** Distinguish "parseable but structurally invalid" from "clean" and route the former to `StorageRecovery` (or snapshot the raw bytes before the first overwrite).

### 15. Capacity advisory counts non-working days as "on time off" `[default · COSMETIC]`
- **Where:** `src/lib/capacity.ts:123` (`timeOffDays++` unconditional) vs `:125` (`overDays` guards `available > 0`).
- **What:** `timeOffDays` increments for every day in the window on time off, including weekends/non-working days, while `overDays` correctly skips zero-capacity days. A time-off block on a day the resource doesn't work still inflates the "on time off for N days" advisory (`AllocationBar.tsx:202`).
- **Fix:** Guard the `timeOffDays++` with `isWorkingDay(resource, day)` (or `availableHoursOnDay > 0`) to match `overDays`.

---

## Runners-up (real, below the cut)

- **scroll-watch listener leak on sub-threshold pointercancel** — `useDragResize.ts:91` skips `onCancel` when `!dragging`, so `AllocationBar`'s document `scroll` watcher (armed at pointerdown) is never torn down; accumulates across gestures and survives unmount. `[default · perf]`
- **Import keeps source `createdAt`/`updatedAt`** — `mutations.ts:172` doesn't stamp; a file missing `updatedAt` renders locally but every server PUT hits `NOT NULL` (`tables.ts`), so it silently never syncs. `[server]`
- **ServerSyncAdapter `drain` partial-write divergence** — `ServerSyncAdapter.ts:131` throws on the first failed op without rollback; a permanently-rejected entity leaves store/server diverged after the 5-retry budget. `[server]`
- **Server re-seeds an emptied dataset on reload** — `/api/meta` `hasData = !isEmpty` (`app.ts:91`) vs local `hasExisting = key present`; a user who clears all data gets demo data resurrected in server mode only. `[server]`
- **`task.phaseId` may reference another project's phase** — `mutations.ts:75` checks only same-account, not phase↔project coherence; `integrity.ts` cascade then leaves a dangling `phaseId` (server FK SET-NULLs it → divergence). Import/direct-API only. `[default/server]`
- **`safeColor` returns the untrimmed value** — `sanitizeImport.ts:31` validates via the trimming `isHexColor` but stores the padded string; downstream color math NaN-fails → grey bar + persisted junk. `[default · cosmetic]`
- **Server `migrateSchema` frozen at `user_version=1`** — `db.ts:60` has only three hard-coded fixes and no generic add-column; a future column added to `entities.ts` won't be added to an existing DB → drift. `[server · future]`
- **`upsertRow` rewrites `createdAt`/`accountId`** — `db.ts:145` `DO UPDATE` excludes only `id`; a direct PUT clobbers the immutable `createdAt` or omits it (→ `NOT NULL`). Overlaps #5. `[server]`
- **Modal focus-steal defeats `autoFocus`** — `ui.tsx:135` focuses the first focusable post-mount, overriding a field's `autoFocus`. `[default · a11y]`
- **`isWithin` relies on zero-padded ISO dates** — `dateMath.ts:73` lexicographic compare; a non-padded `'2026-6-1'` would drop out of capacity/utilization. Guarded only by convention. `[default · latent]`

---

## Verified clean (checked and cleared — not findings)

- **Date/scheduling math** (`dateMath.ts`, `schedulingDays.ts`): uses date-fns `parseISO` (local midnight) + calendar helpers throughout, deliberately avoiding the `new Date("YYYY-MM-DD")` UTC-shift trap; inclusive day counts `end-start+1`; span⇄endDate inverses round-trip. Fuzz-checked.
- **Scheduler geometry** (`lanePacking.ts`, `virtualWindow.ts`, `layout.ts`): 800k+ fuzz cases — no overlapping bars share a lane, no rows dropped at window edges, layout's `+1` inclusive width and date↔pixel inverse compose correctly with `gestureMath`.
- **Server SQL** (`db.ts`, `tables.ts`): every query parameterized (`?`) or uses static table/column names gated by `isKnownTable`; all multi-row writes wrapped in `tx()` with ROLLBACK; FK insert/delete ordering correct; `PRAGMA foreign_keys=ON`; JSON/boolean/null round-trips correct.
- **Store tenancy/cascade** (`useStore.ts`, `integrity.ts`, `mutations.ts`): every scoped `add*` stamps `accountId`; every update/delete routes through `findOwned` (cross-account throw) + the shared cascade; `deleteAccountCascade` covers all `SCOPED_KEYS`; import remaps to fresh ids and re-scopes to the active account; selectors filter by `activeAccountId`.
- **Account deletion** (`AccountPicker`/`AppShell`/`DeleteCompanyDialog`): deleting the *active* account is structurally unreachable (the picker only renders when `!activeAccount`); `previousAccountId` dangling is guarded by `?? null`. (Several finder candidates here were refuted.)
- **Server partial-failure / awaits**: `node:sqlite` is synchronous; `import`/`wipe`/`insertAll`/`replaceAccountSlice` all run in `tx()` with rollback; required-FK-omitted is caught by `NOT NULL` → 400.
