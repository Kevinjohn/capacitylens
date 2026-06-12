# Decisions log (archive)

Append-only history of dated judgement calls and review/remediation rounds from the build of
**Floaty v1**. **Don't read this whole** — it's long and rarely needs reading end-to-end; grep
it, or read the tail to append. The present-tense digest of the decisions that **still
constrain the code** lives in **[`../DECISIONS.md`](../DECISIONS.md)** — start there.

New entries: one line + commit ref (see [`../CLAUDE.md`](../CLAUDE.md) → "Logging a decision").
The prose below follows the original `date — area — decision — why` format; newer entries can be
terser, with detail promoted to the digest only when it's load-bearing.

## 2026-05-29 — M0 Setup
- **Tailwind v4 via `@tailwindcss/vite` plugin** (no `tailwind.config` / PostCSS file) — the modern minimal setup; matches the "bare-bones functional" scope.
- **Vitest with explicit imports + manual RTL cleanup** (`globals` off) — fully type-checked under `verbatimModuleSyntax`, avoids tsconfig globals fiddling.
- **Playwright: chromium only** — faster install, sufficient for local E2E.
- **Dev server pinned to port 5173** — makes Playwright's `webServer`/`baseURL` deterministic.

## 2026-05-29 — M3 CRUD
- **Strict-typed UI layer built in one hand (no subagent fan-out for M3–M6).** The screens share a small `ui.tsx` kit and the exact store API under strict TS (`verbatimModuleSyntax`, no-unused, `erasableSyntaxOnly`); keeping them coherent avoids parallel divergence that would cost more to reconcile than it saves. Subagents are reserved for genuinely independent work (final adversarial verification / E2E) where divergence is cheap.
- **Phases are managed inside the Project form** (add/remove per project) rather than a separate top-level screen — they're an optional grouping, so this keeps navigation lean.
- **Deleting a discipline/project unbinds rather than deletes** dependent resources (discipline → ungroup resources; project → unbind placeholders), matching the integrity layer; only client/project/task/resource deletes cascade to allocations.

## 2026-05-29 — M7 E2E & verification
- **Export/import JSON was added at M7** — it was in the approved v1 scope but missed during M3–M6 and surfaced in review. Import reuses `migrate()` (tolerant of legacy/partial files); export serialises the same `{schemaVersion, data}` the adapter writes.
- **`aria-label` on every `<select>`** — Playwright's accessible name for a select concatenates its selected-option text, so an exact `getByLabel('Task')` failed; the explicit aria-label fixes it (and helps screen readers).
- **E2E drag/resize use short bars** whose right edge stays inside the 1280px viewport; the 9-day seed bar's resize handle sits off-screen.

## 2026-05-29 — Stretch: adversarial review fixes
Five review agents produced 25 findings (4 high, 9 medium). Fixed all high + medium and most lows:
- **Import data-loss (high):** non-Floaty JSON used to migrate to empty and silently wipe data. `parseData` now rejects anything not recognisably Floaty-shaped before migrating; the load path stays lenient.
- **`updateAllocation` integrity (med) + dangling refs (low):** allocation validation (placeholder binding + real resource/task) now enforced on both add and update via a shared `assertAllocation`.
- **a11y (3 high + meds):** accessible Modal (aria-modal, focus trap, focus return, initial focus); allocation bars are keyboard-operable (`role=button`, Enter/Space, aria-label) with a per-row "+" create button; icon Undo/Redo got `aria-label`; Day/Week got `aria-pressed`; ColorField hex input labelled; WCAG-correct `readableTextColor` (linearised luminance + contrast pick); dark-mode brand contrast fixed (white text on `brand-strong`).
- **React lifecycle (med):** `useDragResize` and the lane draw gesture tear down document listeners on unmount; the edit modal closes (instead of resurrecting) if its allocation is undone away; scroll-to-today effect has explicit deps.
- **Durability (med):** save failures surface via a banner instead of being swallowed; seed no longer resurrects after a user clears all data (`hasExisting` seam); `attachPersistence` cancels pending writes on detach.
- **Modern CSS / cleanup:** stronger dark-mode shadow, removed dead `--shadow-card`, fixed the container-query threshold (`@max-[680px]`), wired the `EmptyState` component into all list pages, removed dead `canAssignToResource`/`rangesOverlap`.

**Post-review visual verification:** screenshots revealed the discipline group headers weren't painting (a full-width `sticky left-0` element rendered its label outside the captured viewport, so `getByTestId(...).toBeVisible()` passed while it was invisible on screen). Rebuilt the header to mirror the resource-row structure (sticky 200px label cell + lane area); confirmed visible in light and dark. Lesson: the test gate proves behaviour/DOM, not appearance — screenshots are the visual oracle.

## 2026-05-29 — Modularity pass (decoupling)
Four behaviour-preserving extractions behind the green test gate (no re-architecture):
- **`lib/metadata.ts`** — single source of truth for enum labels; `<select>` options are *derived* from the `Record<Enum,string>` maps (type-exhaustive). Removed the duplicated `TIMEOFF_LABEL`/`TYPE_OPTIONS`/`STATUS_OPTIONS`/`*_OPTIONS` from components.
- **`lib/palette.ts`** — `DEFAULT_COLORS` + `NEUTRAL_COLOR`; one place to tune the brand palette instead of hex literals in each form.
- **`lib/schedulerConfig.ts`** — `Zoom`, `DAY_WIDTH`, `DEFAULT_RANGE_DAYS`, `DEFAULT_ORIGIN_OFFSET_DAYS` (shared by store + view; re-exported from the store for back-compat). View-only pixel geometry stays in `scheduler/layout.ts`.
- **`scheduler/schedulerModel.ts`** — extracted the view-model builder (`buildSchedulerModel`) out of the `SchedulerGrid` god-component into a pure, unit-tested module; the component is now a thin renderer and the filter logic is tested directly.

**Intentionally NOT done** (would trade clarity for abstraction nobody needs at this size): a generic store/CRUD factory and schema-driven forms. The `useStore` singleton import in components is a deliberate, pragmatic choice — revisit only if multi-store/SSR ever appears.

## 2026-05-29 — Features: collapsible disciplines + drag-between-rows
- **Collapsible discipline groups:** `ui.collapsedGroups` (group keys) + a `toggleGroup` action; the header is a `<button>` (`aria-expanded`, chevron) and a collapsed group hides its rows and shows an "N hidden" count. Ephemeral UI state (not persisted with the dataset).
- **Drag an allocation between rows:** `useDragResize` now also reports a vertical pixel-delta (live preview) and the drop coordinates; `AllocationBar` resolves the target row from the lane under the drop point (`data-resource-id` + rect hit-test) and reassigns via `updateAllocation` — which already enforces the placeholder-binding rule, so an invalid drop falls back to a date-only move. Verified by real-browser E2E (drag verticality + reassignment).
- **Drop-target highlight:** while dragging, the hovered row gets a brand inset-ring + tint via an imperatively-toggled `data-droptarget` attribute styled in `index.css` (`color-mix` + inset shadow) — zero store churn / re-renders. E2E asserts the attribute toggles on during drag and clears on drop; verified visually mid-drag.

## 2026-05-29 — Multi-week zoom (1 / 2 / 4 / 6 / 8 weeks)
- Replaced the day/week toggle with **weeks-visible** levels. `ui.zoom: WeeksZoom (1|2|4|6|8)`; `ui.dayWidth` was **removed from the store** — `SchedulerGrid` measures its scroll container (ResizeObserver, with a `FALLBACK_TIMELINE_WIDTH` for tests/SSR) and derives `dayWidth` via the pure `resolveDayWidth(available, weeks)` (clamped MIN 8 / MAX 120), so the chosen week-count fits the visible area. (MAX raised from 56→120 so a 1-week view genuinely fills a normal screen.)
- **Two-tier `DateHeader`**: month spans on top, week-start labels below; per-day numbers when `dayWidth ≥ 18`, weekday letters at `≥ 36`, week-block labels below that.
- **`ResourceLane`**: week-boundary separators always; weekend/unavailable tint only at `dayWidth ≥ 20`; over-markers only on over-days — keeps the DOM light at 8-week zoom.
- **Toolbar**: segmented `1w/2w/4w/6w/8w` (`aria-pressed`, verified by E2E).
- Tests: `resolveDayWidth` unit tests, `DateHeader` tier/coarse-zoom tests, store; E2E asserts density (same bar narrower at 8w) and that the active zoom button tracks (`aria-pressed`). Gate green; verified visually at 1-week and 8-week.

**Deferred (low, documented):** `utilization` reports 0% on zero-availability windows (display-only; per-day over-allocation is still flagged separately); import does not de-duplicate ids/dangling refs (tolerated by design, now gated by the shape check); the timeline row and Resources list both use `data-testid="resource-row"` (no functional impact — never mounted together).

## 2026-05-29 — Grumpy multi-agent review (a11y / security / performance / DX / UX)
Five hostile specialist reviewers produced 43 findings (10 high). User-set fix priority: **Bugs > DX > UX > Performance > Accessibility**. **Security deliberately out of scope** for this pass — the reviewer agreed it's fine for a local single-user app; the latent items (validate colour/import, CSP) only bite once the README's promised backend lands.

### Phase 1 — Bugs (correctness defects pulled from across all lenses). Gate green.
- **Utilisation window (was the worst finding).** The per-resource % was averaged over the whole 120-day range, so the "overbooked" red flag could never fire. Now computed over a **fixed forward 14-day window from today** (`UTILIZATION_WINDOW_DAYS`), decoupled from zoom and pan, and **labelled** ("Load · next 2w"). Chosen over origin-anchored-zoom-weeks because the grid auto-scrolls to today on mount, so an origin window wouldn't match what's on screen and would still shift with zoom. `buildSchedulerModel` takes `utilStart/utilEnd` independent of the visible `days`. The truthful per-day signal — the over-marker — was a 4px hairline; now a full-height tint + 3px top band. The name-column figure also goes **red when the resource is over-allocated on any day in that same 14-day window** (`RowModel.overSoon`, derived from the window's `capacityForWindow`) — resurrecting the "dead red flag" the reviewer roasted (a 14-day *average* almost never crosses 100% for a 3-day spike, so red was keyed off the wrong thing). The flag mirrors the per-day over-markers, so an allocation that spans a non-working weekend (0 availability) also flags — consistent with the existing capacity model. (User left this sub-choice to me; the alternative "timeline-markers-only, never flag the name column" was offered and declined.)
- **Silent drag rejection → toast.** A rejected reassign (placeholder bound to another project) used to `catch {}` and snap back with zero feedback. Added a top-level store `notice` + reusable `Toast` (auto-dismissed in `AppShell`); the catch now surfaces the actual thrown message. (Toast will also replace ImportExport's `window.alert` in the DX phase.)
- **Modal focus bug.** The focus-trap effect depended on `[onClose]` (a fresh closure each render), so any store mutation while a dialog was open yanked focus to the first control and clobbered the focus-return target. Now runs once (`[]`) with `onClose` read through a ref.
- **"Today" re-centres.** The button reset `originDate` but never scrolled; added a `recenterToken` the grid watches to scroll today back into view.
- **`pointercancel` handling.** `useDragResize` and the lane-draw gesture now abort cleanly (clear preview/ghost, detach listeners) when the browser steals the pointer — no stranded previews / leaked listeners.
- **Delete-dialog honesty.** Client delete claimed "This cannot be undone" though it's ⌘Z-undoable; the three big cascade dialogs (client/resource/project) now consistently say "You can undo this with ⌘Z."
- Tests: +8 unit (util-window decoupling, overSoon, modal focus stability, store `notice`/`recenterToken`, toast wiring, rejected-reassign notice, pointercancel abort) and +1 E2E (Today re-centre). 282 unit + 16 E2E green; verified visually (legible over-marker tint; toast copy). **Committed `3e589c6`.**

## 2026-05-29 — Phase 2: Developer experience / maintainability. Gate green.
- **E2E de-brittled (DX high).** The reassign + placeholder specs addressed rows by positional `getByTestId('resource-lane').nth(2)` (welded to seed order) and asserted geometry by magic pixel deltas (`b1.y < b0.y - 30`). Now they select by stable identity (`[data-resource-id="r-nike"]` / `"r-ph-designer"`) and assert the **resulting state** (the bar is now inside Nike's lane) instead of a pixel delta.
- **Drag-reassign hit-testing tested (DX high).** `resourceLaneAt`/`markDropTarget` (imperative DOM, was 40% branch) now have jsdom unit tests stubbing multiple lane rects: a valid reassign updates `resourceId` + highlights only the hovered lane; a rejected one surfaces the notice; a `pointercancel` aborts.
- **Module boundary (DX med).** `BarLayout`/`DayState`/`TimeOffBlock` moved **into `schedulerModel.ts`** (the model owns its output shapes); `AllocationBar`/`ResourceLane` and tests import them *from the model*, restoring one-way data→model→view. (`Filters` is still imported from the store — a defensible downward dep; not moved.)
- **Centralised density thresholds (DX med).** `DAY_COLUMN_MIN_WIDTH` (18) + `WEEKDAY_LABEL_MIN_WIDTH` (36) in `schedulerConfig`, used by both `DateHeader` and `ResourceLane` — reconciles the old 18-vs-20 gap where weekend tint vanished one zoom step before the per-day columns did.
- **Failure UX (DX med).** `ImportExport` replaced its blocking `window.alert` with the reusable toast (and now reports success too); the catch arm has a test feeding bad JSON that asserts the notice fires **and** existing data is preserved. `AllocationModal`'s two `(e as Error).message` casts normalised to `e instanceof Error ? … : fallback`.
- **CI (DX med).** Added `.github/workflows/ci.yml` (tsc → eslint → unit → build → Playwright on push/PR); `CI=true` there activates the previously-dead `process.env.CI` branches in `playwright.config`.
- **Cleanup (DX low).** Duplicate `data-testid="resource-row"` → the scheduler row is now `scheduler-row`; `/_input/` (≈640KB of competitor reference images) untracked + gitignored (files kept on disk); the lane-draw test now stubs `getBoundingClientRect` explicitly instead of leaning on jsdom's zero-rect default.
- Tests: +2 unit (bad-import notice, successful cross-row reassign + highlight). **284 unit + 16 E2E + build green.**

**Deferred (DX low):** the repeated `workingDays: [...] as Weekday[]` casts across ~7 test fixtures — pure test hygiene (production code has no such cast); a shared `makeResource`/`WORKDAYS` factory is a nice-to-have, not done this pass.

## 2026-05-29 — Phase 3: User experience (fixes + features). Gate green.
User scope: **fixes + features** (incl. the bigger product additions). Committed `648b6dc` precedes this phase.
- **Fixes:**
  - `touch-action: none` on allocation bars so a touch-drag moves/resizes the bar instead of fighting the browser's scroll.
  - The row **"+" quick-create defaults to the visible window** (date at the current scroll-left), not always today, so it lands where the user is looking.
  - **Lane-draw click threshold** (`DRAW_THRESHOLD_PX`): a bare click is now a no-op (use "+" for a single day); only a real drag opens the create flow — matches the bar's click/drag split.
  - **Visible, wider resize grips:** 6px invisible spans → 10px hit zones with a grip handle that appears on hover (pointer-events-none inner line so it doesn't steal the resize target).
- **Features:**
  - **Hover/focus detail popover** on bars (portal, so the bar's `overflow-hidden` can't clip it): task, project · client, date range, h/day, status, note. Available on focus too (keyboard/touch), `aria-hidden` so it doesn't double-announce the bar's `aria-label`. Replaces the bare `title` tooltip. `BarLayout` gained optional `project`/`client` names (populated in the model from id→name maps).
  - **Jump-to-date picker** in the toolbar → `goToDate` (new store action): sets `originDate` (with the standard lead offset) + a new `ui.focusDate` and bumps `recenterToken`; the grid's recenter effect now scrolls to `focusDate` (generalised from "today only"), so Today and date-jump share one path.
  - **Draw time off on the timeline:** a Work / Time-off **draw-mode toggle** (`ui.drawMode`) in the toolbar; in Time-off mode a lane draw opens `TimeOffForm` (now accepts `defaults` for resource + dates) instead of the allocation modal.
- Tests: +4 unit (popover hover, lane-draw no-op, `goToDate`, `setDrawMode`) and +2 E2E (date-jump moves the month into view; Time-off-mode draw opens a prefilled time-off form). 288 unit + 18 E2E + build green; verified visually (toolbar controls + popover). **Committed `2428d27`.**

## 2026-05-29 — Phase 4: Performance. Gate green (behaviour-preserving).
Cheap, high-value wins; the existing suite proves no behavioural regression (288 unit + 18 E2E + build).
- **Per-resource slice (the #1 finding).** `buildSchedulerModel` now slices each resource's allocations + time-off ONCE and feeds those to `dayCapacity`/`capacityForWindow`, instead of scanning the whole dataset per day. Removes the O(resources × days × **all-allocations**) cross-term → O(resources × days × **own-allocations**).
- **Cached drag hit-testing.** `AllocationBar` snapshots lane rects once on pointer-down (`snapshotLanes`) and hit-tests the cached list per move; the drop highlight is toggled on only the changed element. Was: two `document.querySelectorAll('[data-resource-id]')` + a `getBoundingClientRect` per lane on **every** pointermove (layout thrash).
- **rAF-throttled ResizeObserver** so a live window drag-resize coalesces to one measure/rebuild per frame.
- **`React.memo(DateHeader)`** — its props (the memoised `days` array + numeric `dayWidth`) are stable across data mutations, so it stops re-rendering ~120 cells on every store change.
- (Bar label/colour context already moved to id→name maps in the UX phase, removing repeated `.find()` in the per-bar loop.)

**Deferred by design — row virtualization + full per-row model memoization.** The model is a single `useMemo` keyed on `data`, so it rebuilds on every mutation (fresh arrays) → `React.memo` on `ResourceLane`/`AllocationBar` can't help without memoising each row's slice, which means either threading per-row memo keys or moving model-building back into the components (reversing the clean pure-model extraction). That payoff only materialises well beyond a tiny agency's scale — the project's explicit non-goal — so it's documented here rather than built. The undo-history (structural sharing) and debounced persist (identity-guarded) were already confirmed cheap by the reviewer.

## 2026-05-29 — Phase 5: Accessibility. Gate green.
- **Bar-label contrast guaranteed (high).** `ensureBarColors(hex)` keeps the chosen hue but nudges its lightness until the picked ink clears WCAG AA (4.5:1) — 4 of 5 default colours previously failed, and the old "≥ 4.5:1" comment was simply false. `AllocationBar` renders the adjusted `bg`/`ink`. `ColorField` gained `pattern` + `aria-invalid` (format feedback); the downstream `ensureBarColors` means any picked colour still renders an AA-safe label.
- **Tentative no longer breaks contrast (high).** Was `opacity: 0.62` on the whole bar (compositing the *text* to ~2.4:1). Now signalled by the dashed border + a diagonal hatch overlay, with a **full-opacity** label on the contrast-safe background.
- **Timeline semantics (high).** The grid container is `role="grid"` (+ `aria-label`, `aria-rowcount`); the date header / group headers / data rows are `role="row"`; the load cell is `columnheader`, the name cell `rowheader`, the lane `gridcell`. Each row carries an **sr-only summary** ("Overbooked in the next two weeks. N time-off periods. M allocations.") — a text equivalent for the colour-only over-marker / time-off cues. Bars already announce their own dates/status via `aria-label`.
- **Keyboard direct-manipulation (med).** A focused bar now moves with ←/→ and resizes the end with Shift+←/→ (feeds the same `applyGesture`); the `aria-label` documents it. The drag/draw remain for pointer users.
- **Faint token contrast (low).** `--c-faint` darkened `#98a1b1 → #6b7280` (light) and lightened `#6b7486 → #8b93a3` (dark) so small faint text (load %, group counts, time-off labels) clears AA.
- **Dialog heading (low).** The Modal title is now an `<h2>` referenced by `aria-labelledby` (a navigable heading) instead of a bare `aria-label` on a `<header>`.
- Resize-grip target size was widened (6→10px) + made hover-visible in the UX phase; combined with the keyboard path above, the tiny target is no longer the only route.
- Tests: +6 unit (`ensureBarColors` AA for every default colour, `isHexColor`, keyboard move/resize, grid roles + sr-only summary, dialog heading). 295 unit + 18 E2E + build green; verified visually (tentative hatch + legible labels).

**Deferred (a11y low):** per-field error *association* (`aria-invalid`/`aria-describedby` on the specific invalid field) — the validation message already announces via `role="alert"`; wiring it to each field needs the modal's single error split into per-field tracking, noted for later.

### Phase 5b — axe validation (the a11y oracle)
`getByRole` passing proves an attribute exists, not that the structure/contrast is valid — the same trap as "`toBeVisible` ≠ legible". Added `@axe-core/playwright` and a permanent `e2e/a11y.spec.ts` (scheduler + a form modal, fail on any serious/critical, `reducedMotion` so entrance animations don't sample as false low-contrast). It immediately caught real defects my role-presence checks missed:
- **`aria-required-children` (critical):** the discipline-group `role="row"` had a `<button>` as a direct child (not a cell). Restructured: the button now lives in a `role="rowheader"` cell + the load figure is a `role="gridcell"`; the per-discipline wrapper is `role="rowgroup"`; `DateHeader` is the header row's `columnheader`; dropped the miscounting `aria-rowcount`.
- **Contrast misses (serious):** the brand wordmark (bumped to large text → 3:1), the active nav link and the "today" date cell (brand-on-brand-soft → `text-ink`), the **Avatar** initials (now `ensureBarColors`), the **Temp** tag (`text-ink` on the amber tint), and the `--c-faint` weekend day-numbers (switched those cells to `text-muted`).
- **Latent bug surfaced:** the dialog title used `text-base`, which in this Tailwind v4 setup is a **colour** utility (`--color-base` is a registered token) — so the modal heading was rendering near-invisible (`#f4f5f8` on white). Fixed to an explicit size (`text-[1rem]`). Verified visually (title now legible).
- Result: **0 serious/critical** axe violations on the scheduler and a modal. (Validated on the scheduler + a form modal — mostly global fixes, so it should generalise, but it's not a whole-app sweep.)
- **Dark-mode axe (added after).** A third axe case with `colorScheme: 'dark'` caught what reasoning missed: the dark `--c-brand-strong` (#6366f1) gave white button text only 4.46:1, so every active toolbar toggle / primary button failed AA in dark. Darkened the dark token to #4f46e5 (white text → ~7:1). Now 0 serious/critical in both light and dark. **295 unit + 21 E2E (incl. 3 axe) + build green.**

## 2026-05-30 — xhigh code-review remediation (14 findings fixed)
A recall-mode multi-agent review of the whole branch surfaced 14 findings (3 high, 5 medium, 4 low, 2 efficiency). All fixed behind the green gate; the pure libs (capacity / dateMath / lanePacking / gestureMath / integrity / migrate) and the undo/redo + assertAllocation paths were confirmed clean.

- **Persistence (2 high/med).** (1) The first-run seed write in `bootstrap` was unguarded — a quota/private-mode failure escaped before `attachPersistence`, so the session silently never saved *and* never showed the banner. Now wrapped in try/catch → `onError` (banner) and persistence still attaches; `main.tsx` also `.catch`es bootstrap. (2) The 300 ms debounced write was never flushed on unload. `attachPersistence` now `flush()`es on `pagehide` + `visibilitychange→hidden` (synchronous `localStorage`), so a tab close within the debounce window no longer drops the last edit.
- **Import safety (high).** A partial/single-section file passed the lenient `looksLikeFloaty` shape check and `replaceAll` then wiped every other section un-undoably. Import now (a) shows a **confirmation dialog** summarising the file's entity counts and that it replaces all data, and (b) applies via a new **undoable** `importData` store action (snapshots onto the history stack) so ⌘Z restores the prior data. `replaceAll` stays history-clearing for bootstrap only.
- **Malformed dates (high, merged).** Empty dates (cleared modal field) rendered NaN geometry; reversed dates (import) rendered negative widths and corrupted lane packing. Three-layer fix: a shared `validateDateRange` (non-empty + `end>=start`) enforced at the **store** boundary on allocation/time-off add+update (validating the *effective* merged range, so note/status-only patches aren't rejected); the modal's missing non-empty check added; and `xForDate`/`widthForRange`/`packLanes` made NaN/negative-safe so imported bad records degrade to invisible bars instead of poisoning a row's origin.
- **Drag/scroll lifecycle (3 med/low).** `useDragResize` now ignores a re-entrant pointerdown while a gesture is live and filters move/up/cancel by `pointerId` (multi-touch no longer cross-commits or leaks listeners). `AllocationBar` re-snapshots lane rects on `scroll` (capture phase — scroll doesn't bubble) during a drag, so a mid-drag scroll can't reassign to the wrong row. The first-render auto-scroll now waits for the measured width (not the fallback) so today/focus centres correctly on any viewport.
- **Validation + display (med/low).** Allocation hours and resource hours must be `> 0`; all four colour forms reject non-hex input via `isHexColor`; `TimeOffList` shows the metadata label (`Holiday`) not the raw enum; `DisciplineList` now shares `byDisciplineOrder` with the scheduler so tied `sortOrder`s order identically; `addTimeOff`/`updateTimeOff` enforce the resource exists (parity with allocations). (Import-time orphan refs remain tolerated-by-design — see the Multi-week zoom "Deferred" note — defended by NaN-safe geometry + the confirm dialog.)
- **Efficiency (2).** `resolveBarColor` now takes the id→entity **maps** the scheduler model already builds (was up to 4 full-array `.find()`s per bar per rebuild). `AllocationBar` memoises `ensureBarColors` on `bar.color` (the 0–30-iteration contrast loop no longer re-runs every render).
- **Reversal of a documented non-goal:** Phase 4 deferred `React.memo` on `ResourceLane`/`AllocationBar` (couldn't help without per-row memo keys). Reversed deliberately: the memo is now effective because the model `useMemo` keeps each row's slice referentially stable across grid-level UI re-renders, and `SchedulerGrid` passes `useCallback`-stable `onEdit`/`onDraw` (with `AllocationBar.onEdit` taking the id so the lane forwards one stable ref). Net win: a lane's per-pointermove `setDraw` draw gesture, and modal-open/close re-renders, no longer re-render every bar (and re-run its colour loop). Full row virtualization remains the documented non-goal.
- Tests: +17 unit (date-range guards, NaN-safe geometry, lane-origin robustness, import confirm/undo, seed-fail path, pagehide flush, colour validation, time-off label, `byDisciplineOrder`, empty-date/zero-hours modal). **312 unit + build green; E2E extended in the same pass.**

### Deferred wishlist items completed (same pass)
- **Per-field error association (a11y low, previously deferred).** Was: a single bottom `role="alert"`. Now the offending field also gets `aria-invalid` + `aria-describedby` pointing at that one alert (no second alert, so existing `getByRole('alert')` assertions stand). Implemented via optional `invalid`/`describedById` props on the shared field components and a small `fail(field, message)` helper in each of the 7 forms.
- **Shared test fixtures (DX low, previously deferred).** `src/test/fixtures.ts` exports `WORKDAYS: Weekday[]` + `makeResourceDraft`; the scattered `[1, 2, 3, 4, 5] as Weekday[]` casts (ResourceList ×5, ui ×1, TimeOffList ×1) now use `WORKDAYS`.
- **Intentionally left as documented non-goals:** `utilization` returning 0% on a zero-availability window (the per-day over-marker + the `overSoon` red flag already convey overbooking there), import id de-dup / dangling-ref pruning (tolerated by design; defended by NaN-safe geometry + the confirm dialog), and full row virtualization (`React.memo` now covers the realistic re-render cost; virtualization only pays off well beyond a tiny agency's scale).

## 2026-05-30 — medium code-review remediation (6 findings fixed)
A medium-effort precision code review of the whole branch surfaced 6 actionable findings (1 correctness/integrity high, the rest med/low + perf). All fixed behind the green gate (336 unit + build).

- **Weekend-spanning utilisation (the worst finding).** `utilization()` summed allocated hours on non-working days (weekends / time off) in the numerator while excluding them from the denominator, so an ordinary multi-week allocation read ~140% and tripped the red "overbooked" flag for someone exactly fully booked on every working day. Both `utilization()` and a new `overAllocatedInWindow()` now skip zero-capacity days on **both** sides of the ratio. This is deliberately distinct from the **per-day over-marker**, which still flags *any* allocation on a zero-capacity day (work scheduled where someone isn't available) — the two "over" signals answer different questions. `schedulerModel`'s inline window loop mirrors the same working-day-only semantics.
- **Import bypassed the integrity boundary (high).** Every other write path validates (real resource/task, placeholder-project rule, non-reversed dates), but `importData` mapped rows straight in. A hand-edited / corrupt file could persist a reversed range (NaN/negative bar geometry, and if it sorted first it NaN-poisoned the whole row's lane origin) or a dangling FK (orphan row). Import now runs the same rules and **drops** invalid allocations/time-off (reversed range, dangling resource/task, placeholder violation), silently — the rest of the import still applies.
- **Scheduler model O(R×A) scan (perf).** `buildSchedulerModel` filtered the full allocations + time-off arrays once per resource. Now grouped into `Map<resourceId, …>` up front → O(A+T+R) instead of O(R×(A+T)). (The earlier Phase-4 win removed the inner per-day cross-term; this removes the outer per-resource one.)
- **Discipline sortOrder collision (med).** A new discipline defaulted its `sortOrder` to the discipline *count*, which collides with an existing order after any delete / custom ordering (then falls back to the name tiebreak and lands out of place). Now defaults to `max(sortOrder)+1`.
- **ResourceLane re-entrant pointer leak (low).** The lane-draw `onPointerDown` lacked the guard + `pointerId` filtering `useDragResize` already has, so a second concurrent touch double-registered document listeners (overwriting `teardownRef`) and could fire `onDraw` twice. Added the `if (teardownRef.current) return` guard and per-pointer move/up/cancel filtering. (Consequence was mild — `onDraw` only opens a modal — but the divergence was a latent footgun.)
- **Import recognisability guard (low).** `looksLikeFloaty`'s `KNOWN_KEYS` omitted `accounts`, so a valid export of an account with no scoped entities was rejected on re-import. Added `accounts`.
- Tests: +2 unit cases on `capacity` (weekend-spanning full booking stays ≤100%; `overAllocatedInWindow` true for a real working-day overbook, false for weekend-only spillover) and +1 on `multitenancy` (import drops reversed-range / dangling allocations + dangling-resource time-off, keeps valid remapped rows). The existing `schedulerModel` "overSoon" test (a genuine weekday overbook) still passes, confirming real overbooking is unaffected. **336 unit + tsc + eslint + build green.**

## 2026-05-30 — five-specialist review remediation (UI / security / perf / DX / UX)

Five grumpy specialist reviews (UI, security, performance, DX, UX) were run over the
whole branch. Their findings were implemented across 9 commits, each behind the green
gate (tsc + eslint + unit + e2e). Highlights:

- **Capacity warning at allocation time (UX critical).** The capacity engine already
  computed over-allocation + time-off conflicts but the modal never asked it. The
  allocation modal now shows a non-blocking advisory ("over capacity on N days / on
  time off for N days") computed over the chosen range against the assignee's *other*
  allocations — the edited one is excluded so it never flags itself. Save still allowed.
- **Unsaved-changes guard (UX critical).** Backdrop closed on `mousedown` the instant
  the target was the overlay → a 3px misclick (or a drag that started in an input and
  released on the backdrop) destroyed an in-progress form. Now closes only on a press
  that both starts and ends on the backdrop; once a field is edited, accidental
  dismissal (backdrop/Escape) is refused with a hint, and a `beforeunload` guard covers
  tab-close/refresh. A clean dialog still closes on Escape (a11y contract intact).
- **Import hardening (security).** File-size + record-count caps (self-DoS/JSON-bomb),
  per-record value sanitisation (junk enums → safe defaults, negative/NaN/huge hours →
  clamped, non-hex colour → fallback), id-less records each get a fresh id (was: all
  collapsed onto `undefined`), a prototype-pollution regression test, and an honest
  post-import delta ("imported 31, 9 invalid skipped"). CSP meta (object-src/base-uri).
- **Strict mode (DX).** `"strict": true` enabled for app + node — *zero* source changes
  needed (the code was already strict-clean; the rigor is now enforced). The
  multitenancy seam's scattered `as never` / `as unknown as` / `!` collapsed into one
  named, typed `scopedTables()` helper. Type-aware lint (`no-floating-promises`).
  (`noUncheckedIndexedAccess` evaluated and left off — ~50 low-value test-only edits.)
- **Perf (the costs that bit at any scale).** `isWithin()` now compares zero-padded
  YYYY-MM-DD strings instead of 3× `parseISO` — eliminates ~99% of the per-rebuild date
  parsing on the hottest path. Search debounced (no per-keystroke model rebuild).
  Route-level code splitting. Memoised `overallUtil` / DateHeader groupings; rAF-coalesced
  the mid-drag scroll re-snapshot.
- **UI.** Inline-SVG icon set replaces the Unicode glyphs; dead `public/icons.svg`
  deleted; `--color-base`→`--color-canvas` rename kills the `text-base` footgun; one
  `--text-2xs` token; shared `controlBase` ends the toolbar input drift.
- **DX dedup.** `useCrudListState` / `useFieldError` + `lib/validation.ts` collapse the
  6×list + 7×form boilerplate (thin hooks only — the heavy generic-CRUD factory stays
  rejected, see above).

### Full row virtualization — implemented (spacer windowing, no new dependency)
The perf reviewer rated this Critical at ~200 resources (jank from ~40–50). The grid
now windows rows vertically: the visible model is flattened into one ordered item list
(group headers + expanded-group rows) and only the on-screen slice (+300px overscan) is
in the DOM — the off-screen scroll extent is reserved by top/bottom spacer divs. Chosen
over a windowing library and over absolute-positioning because **spacer windowing keeps
every row in normal flow**, so the sticky left column, flex layout and all e2e/test
markup are unchanged; only off-screen rows are dropped.
- The math is a pure `computeWindow(heights, scrollTop, viewportHeight)` (handles the
  variable lane heights) — unit-tested at 200 rows, since the windowing path can't run
  in jsdom. A `viewportHeight <= 0` / fits-in-view branch renders everything (the jsdom +
  small-data fallback, mirroring `FALLBACK_TIMELINE_WIDTH`), which is why the ~10-row
  suite + axe stay green.
- a11y preserved: one `role="rowgroup"` wraps the rows (spacers are `aria-hidden`), the
  grid carries `aria-rowcount` and each row a 1-based global `aria-rowindex` so AT knows
  positions even when rows are virtualized out. Validated by the axe e2e (light + dark).
- Vertical scroll is rAF-coalesced into a `scrollTop` state; horizontal scroll lands in
  the same handler but a same-value `setScrollTop` is a no-op (no re-render thrash).

### Project-filter availability (UX 🟠 Major) — implemented (product choice made)
The reviewer flagged that filtering to a project made it hard to see who's free to
staff. Chosen behaviour (over hide-everything or highlight-only): when a project/client
filter is active, resources with **no work on it** stay visible but **dimmed**, showing
their *full real load* so you can judge availability and drag work onto them — with a
**"Show unallocated"** toggle (default on) to collapse to just the matching work.
Implemented in `buildSchedulerModel` (per-row `dimmed` flag; dimmed rows show full load,
matched rows stay focused) + a `Filters.showUnmatched` flag + the toolbar toggle.

### Previously-deferred findings — now implemented
- **Error toasts persist (UX 🟡).** `store.notice` carries a severity ('info'
  auto-dismisses after 4s; 'error' persists until dismissed + gets a danger ring).
  Rejected-reassign and import failures are 'error'; success/info still auto-clear.
- **Drag-commit toast + keyboard start-resize + phase-remove confirm (UX 🟡).** A
  successful drag now confirms with a ⌘Z hint; Alt+arrow resizes the start edge
  (Shift+arrow the end); phase removal has a two-click inline confirm (modal-free).
- **Jump-to-date — kept on-change by design.** Commit-on-blur was rejected: a native
  date input doesn't fire blur when you pick from its calendar popup, so it would break
  the common pick case. On-change is correct here.

## 2026-05-31 — precision code-review remediation (review of the review pass)

A medium-effort precision review (7 finder angles → 1-vote verify) over the five-
specialist remediation diff surfaced 2 confirmed correctness bugs + 5 cleanup/perf/
altitude findings. All fixed behind the green gate (364 unit + 86 e2e + tsc + eslint).

- **Search debounce timer not cancelled on Clear (correctness).** Clearing filters while
  a 180ms search-debounce was pending left an orphaned timer that re-applied the just-
  cleared term — and the render-time reconcile couldn't catch it because `filters.search`
  was already `''`. `Clear` now cancels the timer and resets the local input. (The
  account-switch variant was already safe — it unmounts the toolbar, firing cleanup.)
- **Dirty-guard missed button-driven controls (correctness, data loss).** The Modal
  marked itself dirty only on native `input`/`change` events, so editing only a resource's
  working days via `WeekdayPicker` (button `onClick`, no native event) then pressing
  Escape/backdrop silently discarded the change. The guard now also treats a click on any
  `aria-pressed` toggle inside the panel as an edit — generalises to the whole class of
  toggle controls, not just WeekdayPicker.
- **Windowing prefix-sum rebuilt every scroll frame (perf).** `virtualWindow` split into
  `buildLayout` (the O(rows) prefix-sum, depends only on heights) + `windowFromLayout`
  (the cheap per-frame edge-scan). `SchedulerGrid` memoises heights on `[items]` and the
  layout on `[heights]`, so scrolling no longer pays an O(rows) sweep per frame.
- **Capacity advisory duplicated / O(days×allocations) per keystroke (reuse + perf).**
  Extracted to `lib/capacity.ts` `capacityAdvisory()` with per-day hour bucketing
  (O(window + load)). Now consumed by BOTH the allocation modal and the drag-commit path
  (the latter reads via `useStore.getState()` so it stays off the bar's render/memo path)
  — the over-capacity/time-off rule lives in one place and both write surfaces warn.
- **allocVisible re-inlined the tentative rule (simplification).** Now composes
  `matchesProjectClient(a) && notTentativeHidden(a)`.
- **notice + noticeTone could desync (altitude).** Collapsed the two parallel store fields
  into one `notice: {message, tone} | null` object, so severity can't drift from the
  message. (Analysis note: this makes the store value atomic; the residual "caller forgets
  the error tone" risk is unchanged — that's a per-call decision, not a store-shape one.)

Findings deliberately NOT acted on (verified false / by-design): the `isWithin` string-
compare "regression" was REFUTED — it's behaviour-preserving for all app-generated
(zero-padded) dates, and the only divergence path is an invisible, hand-corrupted import;
the `dirtyForm` global-bool mount/unmount race and "dirty stays true after a reverted
edit" are real but low-confidence / conservative-by-design and were left as-is.

## 2026-05-31 — Settings panel (company rename + theme)

Added a **Settings** nav entry that opens its own route (`/settings`,
`components/settings/SettingsView.tsx`) like the other list pages. Two sections:
rename the active company (`updateAccount(activeAccountId, {name})`, name-required
validation reused from `lib/validation`) and choose the colour scheme.

Judgment calls:
- **Theme is device-global, not per-account.** It lives in its own localStorage key
  (`floaty/theme`), NOT in `AppData`/the persistence adapter — a colour-scheme
  preference is a property of the browser, not of a tenant's data, and shouldn't
  travel through export/import. The reactive *preference* is held in the Zustand
  store (`theme`/`setTheme`) for consistency with the rest of the app (no second
  state system); `setTheme` writes the localStorage key + repaints the DOM.
  `lib/theme.ts` holds the pure read/write/resolve/apply helpers.
- **Default is `light` — a deliberate behaviour change.** Previously the UI flipped
  to dark purely via `@media (prefers-color-scheme: dark)`, so OS-dark users got dark
  automatically. Now the default preference is `light` (per the request); OS-dark
  users see light until they pick **Match system**. The media query is gone from CSS:
  the dark palette moved to `:root[data-theme="dark"]`, and JS resolves `light|dark|
  system` to a concrete scheme written to `<html data-theme>` (so the explicit and
  OS-following choices share one mechanism). `system` mode stays live via a
  `matchMedia` change listener wired in `main.tsx`.
- **FOUC guard.** A tiny inline `<head>` script in `index.html` sets `data-theme`
  before first paint (the module `main.tsx` is deferred and would otherwise flash the
  light default for dark users); it mirrors `readStoredTheme`/`resolveTheme` and fails
  safe to light.

## 2026-05-31 — Scheduler header clipped the weekday labels (bug + a11y)

The sticky header row had a hard `height: 44px`, and `DateHeader`'s day tier used
`flex-1` (flex-basis `0`), so the two-line date+weekday cells didn't count toward the
row's intrinsic height — the weekday labels (THU/FRI/…) overflowed the 44px row and
bled, clipped, beneath the 44px-tall sticky left column. It also broke under a larger
base font size (px height doesn't follow font scaling).

Fix: the header row now uses `minHeight` (a floor, not a cap) so it grows to its
content, and the day/week tier uses `flex-auto` (basis `auto`) so the cells' real
height is counted while still filling any slack. The month tier and cells switched
from a fixed `height: 16` to padding-driven heights (`py-*`) so the whole header
scales with font size. `LAYOUT.headerHeight` is unchanged in value (44) but is now
documented + used as a minimum. Group-header/row heights elsewhere are still fixed px
— same latent font-scaling fragility, left as-is since only the date header was
reported (noted here as a known follow-up).

## 2026-05-31 — code-review remediation (Settings + week-view findings)

Fixed the actionable findings from the precision review of the Settings panel,
header-clip, and week-view commits:

- **Company switch ignored the new "current week" default (bug).** `defaultUI()`
  snaps origin/focus to this week's Monday, but `setActiveAccount` only reset
  filters/collapsed/selection — so switching company inherited the previous tenant's
  panned origin. It now also resets `originDate`/`focusDate` to `startOfWeekISO(today)`.
- **Settings name field went stale on undo/import (bug).** The company-name input was
  seeded once via `useState`; a ⌘Z that reverted the rename left the field showing the
  old edit with Save re-enabled. Added the render-time reconcile pattern (as in
  `SchedulerToolbar`) keyed on the account name, so the field follows external changes
  without clobbering in-progress typing.
- **`startOfWeekISO` hand-rolled week math (reuse).** Replaced `(weekdayOf+6)%7` with
  date-fns `startOfWeek(…, { weekStartsOn: 1 })`, matching how the rest of `dateMath.ts`
  wraps date-fns; the Monday convention is now a single explicit option.
- **Dead unchanged-name guard (cleanup).** Removed the unreachable
  `if (trimmed === activeAccount.name) return` in `saveName` — the Save button is already
  `disabled={nameUnchanged}` on the same comparison.

**Deliberately NOT changed — body-row font-scaling (finding #5, deferred):** group-header
and resource rows keep fixed-px heights because those heights feed the row virtualizer's
prefix-sum (`buildLayout`/`windowFromLayout`); switching them to `minHeight` like the date
header would desync the spacer math. Verified during review to be **clip-only/cosmetic**
under an enlarged *base font size* (browser zoom already scales px correctly), and the bug
that was reported (the date header) is fixed. A real fix means measurement-based row
virtualization — a separate, riskier change out of scope for this remediation. Left as the
existing documented follow-up.

## 2026-06-01 — Scheduler: utilisation display toggles + placeholder treatment + layout fixes

A batch of scheduler refinements (two commits). Behind the green gate (unit + e2e + tsc).

### Utilisation display
- **"Load" → "Utilisation" everywhere on the schedule** (header summary, per-discipline
  group summary, per-resource cell, tooltips) — one consistent term for the figure.
- **Three device-global display toggles** (Settings → new **Utilisation** group): *Show
  Total / Discipline / Personal Utilisation*. Modelled on the theme preference — own
  localStorage key (`floaty/utilizationPrefs`), NOT in `AppData`/persistence, so they don't
  travel through export/import. Reactive value + `setUtilizationPref` live in the store;
  `lib/displayPrefs.ts` holds the pure read/write helpers (tolerant of partial/legacy JSON,
  defaults all-true). They are **wired**, not inert: each gates its figure on the scheduler
  (total → header, discipline → group header, personal → per-row cell). Default-on keeps
  current behaviour until a user flips one.

### Grid full-width fix (bug)
- The grid only painted ~2 weeks of rows past the header. Root cause (confirmed by measuring
  the live DOM): the header row and `rowgroup` are flex items of the `flex-col` scroll
  container, so default `align-items: stretch` clamped their width to the container's cross
  size (the viewport) while the wide lane (`width: totalWidth`) overflowed. Fix: `min-w-max`
  on both so they size to content and the whole timeline scrolls. Surfaced when
  `DEFAULT_RANGE_DAYS` grew to 120.

### Placeholder ("slot") treatment in the schedule view
- **Ordered people first, placeholders second** within each discipline — a stable sort in
  `buildSchedulerModel` (`'person'` before `'placeholder'`), preserving relative order
  within each partition. Scoped to the model, not `resourcesByDiscipline` (whose general
  ordering contract the selector test pins).
- **Avatar shows a variable `@`** instead of initials for placeholders
  (`PLACEHOLDER_AVATAR_SYMBOL` in `ui.tsx` — one-line change when the treatment is revisited).
- **Diagonal light-grey hatch** marks placeholder rows (`.hatch-lines` utility in
  `index.css`, theme-aware lines-only so it layers over any background-color). Applied to the
  left column and as a behind-everything layer in `ResourceLane` (new `placeholder` prop).
- **Dropped the "slot" pill; quote the name instead** (e.g. `"Senior Designer"`), schedule
  view only — the quotes carry the meaning with less chrome.

### Left-column +/% control
- The add-allocation box now always `self-stretch`es to the full row height with each cell
  `flex-1`: the `+` fills the box alone (personal off), or `+`/% split it 50/50 (personal on),
  and both grow when a row gets taller for stacked allocations. Only the start border is
  drawn — the row's `border-b` and the panel's `border-r` close the box, removing the doubled
  hairline that read as a border-inside-a-border. Sits flush to the panel's right edge.

### Lighter horizontal lines (light mode)
- The scheduler's horizontal dividers (resource rows, group headers, sticky header bottom)
  read a touch heavy in light mode. Added `--color-line-soft` (`#eef0f5` light; equal to
  `--color-line` in dark, since only light read heavy) and switched those horizontal borders
  to `border-line-soft`. Vertical dividers and dark mode unchanged.

### Native <select> chevron + popup (UI polish)
- Native `<select>` drew its own chevron with too-tight right padding (macOS). Fixed by
  suppressing it (`appearance-none`) and painting our own chevron via background-image at a
  consistent ~0.7rem inset, reserving room with `pr-9` — see `selectChevronClass` /
  `selectChevronStyle` in `ui.tsx`, applied to `SelectField` + the three scheduler-toolbar
  selects. Kept off `controlBase` so text/date inputs that share it don't get a phantom arrow.
- **Open-popup alignment is a known limitation, deferred.** When opened, the native option
  list renders off to the left / wider than the trigger and doesn't cover the box. That popup
  is drawn by the OS, not the DOM — no CSS (`position`, `inset`, transform) can reach it. The
  only fix is a custom listbox/combobox (button + popover + ARIA + keyboard nav) replacing
  every `<select>` — a real component with an accessibility surface. Chose to keep native for
  now; **revisit if/when we want pixel control over the dropdown.**

### Scheduler undo/redo toolbar buttons hidden (deferred)
- Removed the undo/redo icon buttons from `SchedulerToolbar` (they confusingly read as inert
  because they're disabled until history exists). The functionality is unchanged — undo/redo
  remain on ⌘Z / ⌘⇧Z via the global handler in `AppShell.tsx`, and the store history
  (`past`/`future`) is untouched. **Come back to this** to decide on a clearer affordance
  (e.g. always-visible with a tooltip, or a count badge) before re-adding.

## 2026-06-01 — Colour picker → preset swatch popup

### `ColorField` is now a swatch picker, not a hex/RGB tool
- The old `ColorField` paired a native `<input type="color">` with a hex text field —
  it assumed users think in hex/RGB. Replaced its internals (same props, so all four
  call sites — `ClientForm`, `ProjectForm`, `DisciplineForm`, `AccountPicker` — update
  for free) with a trigger button that opens a grid of preset swatches. Picking a swatch
  is the only way to set the value, so the stored colour is **always** a valid 6-digit hex.
- **Why no custom-hex escape hatch:** the user explicitly wanted something simpler than
  hex codes; presets-only removes the whole "is this a valid hex" failure mode.
- `validateHex` + the form submit guards are left intact (defensive; presets always pass),
  so no validation/storage changes. The one E2E-style "rejects invalid hex" unit assertion
  became unreachable and was replaced with a swatch-pick-and-save test.
- **Popup opens upward (`bottom-full`):** the colour field is the last field in every
  form, and the `Modal`'s `overflow-y-auto` would clip a downward popup. Verified visually
  in all three modal contexts plus the non-modal company gate (`AccountPicker`).
- Swatch buttons carry `aria-pressed` — doubles as the selected-state indicator *and* lets
  the `Modal` dirty-guard (which watches `[aria-pressed]` clicks) treat a pick as an edit.

### Palette — 13 hues × 4 shades, generated from HSL (`lib/palette.ts`)
- After two rounds of user feedback, settled on a **13-column × 4-row** grid (52 swatches):
  columns sweep the spectrum (red → red-orange → … → pink) with a dedicated **brown** at
  the end; rows step lightest→darkest. Earlier tries (6 hues × 4 shades, then 24 distinct
  hues at one tone) read as "not enough variety" / "shades too close".
- Generated from HSL rather than hand-picked Tailwind shades so hues land where specified
  and rows are even. Final lightness range is **85% → 35%** (per-row step ~16.7) for a
  strong, obvious gradient; brown rides ~13pts darker so it reads brown, not orange.
- `DEFAULT_COLORS` remapped to **row-2 (medium-vivid)** members of the matrix so default
  entities stay saturated *and* a freshly-opened form highlights its default swatch.
- `SWATCH_COLUMNS` is exported and drives the grid's `gridTemplateColumns` so the layout
  stays in sync with the palette width.

### Note: `US-RES-09-resource-colour.md` is stale (pre-existing, not touched here)
- It describes a resource colour picker, but `ResourceForm` has no colour control —
  resources derive colour (`DEFAULT_COLORS.resource`). Left as-is; flag for a future
  doc cleanup unrelated to this change.

## 2026-06-01 — Review fixes: server schema migration + scheduling-mode persistence + import hardening

### Server DB is now migrated on open (`server/src/db.ts`)
- `openDb()` only ran `CREATE TABLE IF NOT EXISTS`, so a file written by an older
  schema kept its old columns/constraints and broke after a model change (the concrete
  repro: seeding a general task hit `NOT NULL constraint failed: tasks.projectId`
  against a stale `.e2e.db`). Added `migrateSchema()`: reordered `openDb` to run
  `SCHEMA_SQL` → `migrateSchema` (foreign keys still OFF — node:sqlite's default) →
  enable FKs, so a table rebuild's DROP/RENAME is safe.
- **Introspection-gated, not version-gated.** Each step inspects the live shape
  (`PRAGMA table_info`) and acts only when the old shape is present, so the whole pass
  is idempotent and a no-op on a current/fresh/`:memory:` DB (both fresh and old files
  start at `user_version` 0 — the version is only a fast-path, not the safety mechanism).
- tasks.projectId went required→optional; SQLite can't relax NOT NULL in place, so the
  table is **rebuilt** (12-step) with a `foreign_key_check` before commit. New columns
  are added with guarded `ALTER TABLE ADD COLUMN`.
- Covered by a dedicated test (`db.migrate.test.ts`) that hand-builds an old-shape file
  — a normal/e2e run creates a current-shape DB, so the migration is a no-op there and
  would otherwise be silently unverified.

### `schedulingMode` / `ignoreWeekends` now persist server-side (`server/src/tables.ts`)
- Both existed in the shared types but were missing from the table mapping + DDL, so a
  Days/Blocks choice or an "ignore weekends" flag silently vanished on a server reload.
- `ignoreWeekends` is stored as a **json column** — node:sqlite can't bind a raw JS
  boolean, so it round-trips as `"true"`/`"false"` (absent → NULL → omitted on read,
  matching the client object). `schedulingMode` is a plain optional TEXT column.

### Blocks-mode `hoursPerDay: 0` is no longer inflated (`shared/src/lib/sanitizeImport.ts`)
- A blocks allocation persists `hoursPerDay: 0` (span counts, load ignored). The import/
  server sanitiser treated 0 as junk and rewrote it to 8, turning an imported/served
  block into a full-load allocation. Split out `clampAllocHours` (allows `>= 0`) for
  allocations; resources' `workingHoursPerDay` keeps the strict `> 0` `clampHours`.

### Import drops/repairs dangling refs before they reach SQLite (`shared/src/domain/mutations.ts`)
- `remapAndValidateImport` previously only dropped invalid allocations/time-off, so a
  hand-edited file could persist a project with a missing client, a phase with a missing
  project, or a resource/task bound to a missing parent — which the server DB's foreign
  keys then reject, failing the whole import. It now repairs referentially in
  dependency order: a dangling **required** FK drops the record (mirrors ON DELETE
  CASCADE), a dangling **optional** FK is unbound (mirrors SET NULL; a task unbinds to a
  general task and drops its now-orphan phase). `/api/import` also wraps the write in
  try/catch (→ 400 via the error classifier) as defence-in-depth.

### Placeholder Project select stays ENABLED, restricted by options (not disabled)
- A placeholder is bound to one project but can also take **general** (no-project) tasks,
  so the allocation modal's Project select offers exactly "bound project + general" and
  remains enabled — "locked" means *restricted*, not *immutable*. This is intentional;
  the specs (`allocation.spec.ts`, `features.spec.ts`) now assert enabled + restricted.
  (The inline hint still reads "locked to its bound project" — accurate enough, left as-is.)

### Control styles moved to `src/components/common/controls.ts`
- `selectChevronStyle` (a style **object**) exported from the component module `ui.tsx`
  tripped `react-refresh/only-export-components` (lint failure). Moved the four shared
  control-style constants to a non-component module; `ui.tsx` and the toolbar import
  from there.

### Stale E2E specs updated to match intentional UI changes
- Create-mode allocation modal hides the Assignee select (assignee named in the title);
  undo/redo toolbar buttons are hidden (feature lives on ⌘Z); general tasks live in
  their own section with no per-row "General" label. The specs that asserted the old
  shapes were updated (not left failing, which would mask real regressions).

## 2026-06-01 — Demo-readiness: text-input validation + decision sign-offs

Reviewed the open judgment calls in this log with the user ahead of a controlled demo
(Floaty goes up tonight behind **subdomain HTTP auth** for ~5 friends to trial). Three
were resolved; one small feature was built.

### Text-field input validation (built)
- The user wanted junk — emoji, control / zero-width characters — kept out of text
  fields, but real names (`José`, `Müller`, `O'Brien & Co`, CJK) must still work. So the
  rule is a **denylist, not an ASCII allowlist**: reject `Extended_Pictographic` + `So`
  (emoji incl. **flags** / regional indicators, plus dingbats and ™ © ® °) and
  `Cc`/`Cf`/`Cs`/`Co`/`Cn` (control, format/zero-width, surrogate, private-use,
  unassigned); allow all letters/marks/digits/punctuation/whitespace and currency/math
  symbols (€, £, +, =). Newlines/tabs are allowed in multiline notes only. (The user
  leaned strict — "no emoji or any unicode etc." — so `So` is in, accepting that ™/©/®
  are also blocked, which is fine for name/note fields.)
- One definition in **`shared/src/lib/strings.ts`** (`hasDisallowedChars` + `cleanText`
  + `MAX_NAME_LENGTH` 100 / `MAX_NOTE_LENGTH` 1000), imported by client **and** server so
  they can't drift. The **forms reject** (inline error "Remove emoji or special
  characters." via a new `validateText` in `src/lib/validation.ts`, which `validateName`
  now delegates to — so every required-name field inherits the rule for free); the
  **import + server write paths strip** (`cleanText` in `sanitizeImportedRecord` and the
  server's `sanitizeWrite`), matching the existing repair-don't-reject import philosophy.
  `TextField`/`TextAreaField` also carry a native `maxLength` backstop.

### CSP — assessed, deferred (no change)
`index.html` already ships the free wins (`object-src 'none'; base-uri 'none'`). A full
`script-src`/`style-src` policy is **not** a quick win here: the head has an inline FOUC
theme script (would need hashing) + Vite injects inline styles, and a full policy belongs
in a **response header at the host/CDN** — which is exactly where the demo's HTTP auth
lives. Right place, wrong time. (App-level auth deliberately **not** added: the subdomain
gate covers the 5-person trial; last-writer-wins, no per-user isolation, as before.)

### Undo/redo — keyboard-only is settled (was "come back to this")
Confirmed: the scheduler toolbar stays free of undo/redo buttons; the feature lives on
⌘Z / ⌘⇧Z (global handler in `AppShell`). No longer an open question.

### Resource colour — derive from discipline; spec corrected
Confirmed the shipped behaviour (a resource has no colour control; its colour follows its
discipline). Rewrote the stale **`US-RES-09-resource-colour.md`**, which still described a
per-resource hex picker, to describe discipline-derived colour.

## 2026-06-02 — Full-tree code-review remediation (Round 2: 14 findings + 8 addendum items)

A second max-effort, whole-codebase review of the post-Round-1 tree (the full breakdown,
mode tags, and verified-clean list live in **`CODE_REVIEW.md` → "🔁 Round 2"**). Every finding
and every lower-severity/cleanup item is fixed with a regression test. Final suite **root 430 ·
shared 111 · server 40 · e2e 89 = 670** green; type-check + lint clean; root coverage up on
every metric. `[default]` items hit the local-first app; `[server]` items only the off-by-default
API. Nothing here regressed the Round-1 fixes.

### Scheduler gesture/geometry cluster (`AllocationBar.tsx`, `gestureMath.ts`, `SchedulerGrid.tsx`)
- **Drag preview now matches the commit (`#4`).** The live preview was a raw calendar pixel
  shift while the commit ran weekend-aware `applyGesture`, so a Mon–Fri bar moved/resized across
  a weekend **jumped** on pointer-release. The preview now runs the SAME `applyGesture` and
  reconstructs pixels from the snapped dates via `differenceInCalendarDays` (left) +
  `daysInclusive` (width) — exactly how the model places `bar.x`/`bar.width`, so no jump.
- **Cross-row reassign follows the TARGET's working week (`#5`).** Dates were computed with the
  source resource's `workingDays` then written to the target. `onCommit` now resolves the drop
  target first and a `computeFor(resourceId)` helper snaps dates against the resource the
  allocation will belong to (target on reassign, source otherwise; source-only fallback when a
  reassign is rejected).
- **The dragged row is PINNED for the gesture (`#6`).** A mid-drag vertical scroll could
  virtualise the dragged `AllocationBar` out of the DOM, tearing down its document pointer
  listeners and silently losing the drag. A transient store field `draggingAllocationId`
  (plain `set`, never `mutate` — never on the undo stack) freezes the scroll input
  (`onScroll` skips `setScrollTop` while dragging; a one-shot effect catches the window up on
  release). Released on commit/cancel/click **and** on unmount if the bar still owns it
  (so the window can't stay frozen if the bar is deleted/account-switched mid-drag).
- **Weekend over-drag no longer zeroes the span (`A`).** A resize dragged past the opposite edge
  clamped onto a possibly-non-working `endDate`/`startDate`, leaving the edge on a weekend and a
  0-working-day span (silently keeping old hours). The clamp now snaps to a working day.
- **Tight-zoom bars stay visible (`B`).** A fixed `barInset` collapsed a single-day bar to a 1px
  sliver when `dayWidth ≈ 2·barInset`; the inset is capped to `width/3` so the bar stays centred.

### AllocationModal `RangeError` crash (`#1`, `AllocationModal.tsx`, `schedulingDays.ts`)
A huge "Days over" derived an end date past the 4-digit-year range; the hint's `format()` then
threw `RangeError` mid-render, replacing the scheduler with the router error screen. Capped the
span in `endDateForSpan` (new `MAX_SPAN_DAYS`, ~100 years — protects every consumer at the one
domain function), guarded the hint (`endDateHint` skips an invalid date), and added `max` to the
field.

### Persistence & sync (`ServerSyncAdapter.ts`, `persist.ts`)
- **Unload-only dispatch-all flush (`#14`).** `drain()` awaits ops sequentially; on a `pagehide`
  the event loop dies after the first await, so only the first request got on the wire (a cascade
  delete closing the tab lost the rest). Added `saveAll(data, { unload })` → `flushUnload`, which
  fires every op up-front with keepalive. **`drain` stays sequential/ordered for the normal path
  on purpose** — a first attempt at a blanket-concurrent `drain` was reverted after tracing that
  it would cascade-400 the normal server-mode import (the FK tree fanned across the browser's
  connection pool, arriving out of order). The unload flush is **conditional on `pending`** —
  an e2e round-trip caught an unconditional pagehide write resurrecting data after an external
  `localStorage.clear()`. `visibilitychange→hidden` fires before `pagehide` (page still alive to
  dispatch), so the first does the work and the second is a no-op.
  - **Honest residual:** this covers the *debounced-but-unflushed* window; a `[server]`-mode close
    *during* an already-in-flight `drain()` can still drop later ops. Pre-existing, strictly
    improved; closing it fully would need the local adapter to no-op an unchanged-blob write —
    not worth it for an off-by-default mode. Documented in `CODE_REVIEW.md`.
- **Stranded-write re-attempt (`D`).** The bounded retry budget stops a permanently-failing write
  from retrying forever, but a network outage shouldn't strand the delta until the next edit. An
  `online` event (and returning to the tab) now re-attempts with a fresh budget — gated on a real
  prior failure so an idle event never triggers a needless full re-write.

### Server (`server/src/*`)
- **First-run seeding gates on the persistent marker, not emptiness (`#13`).** `index.ts` seeded
  whenever the DB was empty, so a user who deleted all their data got the demo dataset back on the
  next restart — the exact bug the `_meta` `initialized` marker exists to prevent (and which
  `/api/meta` already used). Extracted `seedIfUninitialized(db, data)` (gates on `isInitialized`)
  and unit-tested the predicate directly.
- **Junk `schedulingMode` dropped on direct account writes (`C`).** `sanitizeWrite` repaired
  accounts' colour + name but not the `schedulingMode` enum, so a hand-crafted `/api/accounts`
  write could persist a mode the scheduler can't handle. Added a `SCHEDULING_MODES`
  (shared, runtime) allow-list check.
- **One `ownsRow` tenant predicate (`F`).** The cross-account ownership check was hand-rolled in
  three handlers (PUT/PATCH immutability → 409, DELETE scoping → 404). Extracted one `ownsRow`
  predicate so a future write path can't silently skip it. (Still defense-in-depth, not real
  isolation — the account is client-asserted until session auth lands; see Round-1 `#5`.)
- **`markInitialized` once per bulk insert (`E`).** `insertAll`/`replaceAccountSlice` ran the
  `_meta` upsert per row; an `insertRowRaw` primitive does the insert and the bulk paths mark once.

### Store / import / domain
- **Import "⌘Z to undo" only when something landed (`#2`).** A file whose records all drop
  (`imported === 0`) makes the store no-op (no undo entry), but the toast still said "Press ⌘Z to
  undo" — luring the user into reverting a *prior, unrelated* edit. Now shows an error notice
  instead when nothing imported.
- **`updateTask` validates the merged row (`#11`).** It validated the raw patch, so a `phaseId`-only
  patch was wrongly rejected and a `projectId`-only patch left a stale cross-project `phaseId` the
  server later 400s on. Now merges over the existing row before asserting (matches `updateAllocation`).
- **Resource hours clamped at the store boundary (`#12`).** `addResource`/`updateResource` never
  clamped `workingHoursPerDay`. A new shared `clampWorkingHoursPerDay` (strict `(0,24]` — a resource
  must work a positive day, unlike an allocation where 0 is legal) is now applied. This also
  **unifies the clamp split** noted on 2026-06-01: `clampHoursPerDay` (allocations) and
  `clampWorkingHoursPerDay` (resources) live in `entities.ts` and are shared by the store **and**
  the import sanitiser, so the two write paths can't drift (`G`).
- **De-dupe imported working days (`#8`).** `safeWorkingDays` filtered by range but not for
  duplicates, so `[1,1,1,1,1,1,1]` reached length 7 and the scheduling math read a Monday-only
  resource as a 7-day worker. Now collapses to distinct sorted weekdays.
- **Per-table id map on import (`#10`).** A single global `idMap` keyed only on the source id
  misrouted a foreign key when two records in different tables (corruptly) shared an id, silently
  dropping the referencing subtree. Now one id map per entity table.
- **Keycap-emoji gap closed (`#9`).** The text denylist (see 2026-06-01) omitted Mark categories,
  so the emoji variation selector U+FE0F and combining keycap U+20E3 slipped through both form
  rejection and import stripping. Added `\p{Me}` + the variation-selector ranges — deliberately
  NOT a blanket `\p{Mn}` ban, which would strip legitimate decomposed accents (e.g. `e`+U+0301).
- **Capacity hot-path hoist (`H`).** `capacityAdvisory` called `isWorkingDay` (and `isOnTimeOff`)
  twice per day; derived once and reused.

### Triaged OUT of scope (not fixed — recorded for honesty, not deferred excuses)
Two finder candidates were judged not worth changing as part of "all of these". **Both were
revisited 2026-06-02 (see next section): item 1 was hardened with a loud guard; item 2 was
confirmed left.**
- `server/src/db.ts` `migrateSchema` has no path for a future **required** column (only optional
  columns auto-add). Latent — the code comment already states a required addition needs an explicit
  rebuild step (as `tasks.projectId` got). No current trigger. → **Now guarded (2026-06-02).**
- `server/src/app.ts` `statusFor` maps any constraint-failure message to HTTP 400, so an internal
  (server-fault) constraint error would surface as 400 not 500. A documented heuristic; robustly
  distinguishing caller-fault from server-fault needs more than the message string. → **Confirmed
  left (2026-06-02).**

## 2026-06-02 — Revisited the two triaged-out items (pre-share tightening)

Re-examined both deferred items with explicit permission to make breaking changes (still pre-share,
local-only). One was hardened; one was confirmed left — and the asymmetry is the point.

### 1. `migrateSchema` required-column drift → now FAILS LOUDLY (`server/src/db.ts`)
The gap is real and has an **incident history**: `migrateSchema` exists *because* a stale on-disk DB
once drifted (the `tasks.projectId` NOT NULL regression against a stale `.e2e.db`). The *proper* fix —
a generic required-column migration — can't be done automatically: SQLite can't ALTER-ADD a NOT NULL
column to existing rows, and there is no universal backfill value, so it inherently needs a per-column
human decision (an ordered-migration framework — over-engineering for a local prototype). So rather than
leave a silent footgun, we made the failure **loud and early**. New `assertSchemaCurrent` runs in `openDb`
right after `migrateSchema` and throws a clear error naming any column the spec (`TABLES`) declares that
the live DB lacks. Previously a missing required column was *silent* — it doesn't even throw on read
(`fromRow` yields `undefined`) and only surfaced later as a cryptic `no column named X` on the first write
that named it. Now a developer who adds a required column without a rebuild step is told exactly which
column, at startup. **Not a breaking change**: a no-op on every fresh / current / already-migrated DB
(every declared column is present), so it never fires in a normal run.

`assertSchemaCurrent` also closes a **sibling** drift class (added the same day at the user's request,
having okayed pre-share breaking changes): a column's `optional?` flag (object-level, in `TABLES`) and its
`NULL`/`NOT NULL` in `SCHEMA_SQL` (DB-level) are two hand-maintained sources of truth that nothing else
checked agree. They agree today (verified), but a future drift is a real bug — an optional-but-NOT-NULL
column rejects a legitimately-omitted field (confusing 400), and a required-but-nullable column reads a
NULL back as `undefined` for a field the model treats as always-present. The guard now also throws on any
such mismatch, exempting only the `id` TEXT PRIMARY KEY (PRAGMA reports `notnull=0` for a TEXT PK — a
long-standing SQLite quirk — so it would otherwise look like a false mismatch). This is the targeted
*agreement check*, NOT the deeper refactor of unifying `SCHEMA_SQL` generation into `TABLES` (generating the
DDL from one spec) — that was deliberately declined as over-scoped; the check captures the drift-safety
without it. Two new `db.migrate.test.ts` cases prove both branches fire (old `accounts` missing the required
`color` → `/accounts\.color/`; old `accounts.schedulingMode` declared `NOT NULL` against an optional spec →
`/nullability/`); full server suite stays green (42/42).

### 2. `statusFor` constraint→400 heuristic → deliberately LEFT (`server/src/app.ts`)
Confirmed correctly triaged out, for a sharper reason than "not worth it": **the only correct fix is a
larger feature, and the half-measure makes it worse.** `validateWrite` does NOT check foreign-key existence
(that's the DB's job), so a legitimate *caller* error — a PUT referencing a non-existent `parentId` —
reaches the DB as an FK violation. The current "constraint → 400" is therefore *protecting* that case;
flipping constraint errors to 500 would mislabel real caller errors as server faults (worse — you'd chase
phantom server bugs for user typos). Doing it *properly* means lifting referential-integrity checks up into
the validation layer, then treating any constraint error that still escapes as 500 — a feature, not a
cleanup, and exactly the "needs more than the message string" the original note called. Also verified the
distinction has **zero functional effect today**: the whole client path (`ServerSyncAdapter.apply` / `drain`
and `persist.ts`'s 5-attempt retry budget) branches only on `!res.ok` and retries every failure identically
— 400 vs 500 survives solely in a display/log string. Rejected the tempting middle step of swapping the
message regex for a structured SQLite error code: `constraint failed` is SQLite's long-stable phrasing, so
it would harden near-zero fragility for no functional gain against an API nothing branches on.

## 2026-06-02 — Modularity pass (risk-prioritized extractions)
Reviewed a five-stage modular-refactor plan and executed only the **risk-prioritized subset**: the
genuinely-pure extractions, where a green gate actually *proves* the extraction is safe. The high-churn
structural splits were deferred (rationale below). All behaviour-preserving — store API, REST API, routes,
`data-testid`s and E2E flows unchanged; full suite green (web 439 + server 42 unit, 89 E2E, lint + `tsc`
clean). The four did-now extractions:

- **`data/syncOps.ts`** — moved the pure diff/apply core (`diffOps`/`applyOps` + the `Op` type) out of
  `ServerSyncAdapter`, which now **re-exports** them so `ServerSyncAdapter.test.ts` and every import site
  resolve unchanged. The adapter is left owning only the network / queue / drain path.
- **`server/src/{rowCodec,schema,txn}.ts`** — split `db.ts` (was schema migration + assertion + row codecs +
  transaction helper + CRUD/bulk in one file) into `rowCodec.ts` (pure `toRow`/`fromRow`), `schema.ts`
  (`migrateSchema`/`assertSchemaCurrent`, still exercised *through* `openDb` so `db.migrate.test.ts` needed
  no change), and `txn.ts` (the shared `tx` helper). `tx` had to leave `db.ts` specifically because both
  `db.ts` and `schema.ts` use it — keeping it in `db.ts` would make `schema.ts`↔`db.ts` a runtime import
  cycle (the back-edges to `db.ts` for the `Db` type are type-only, so erased). All 14 `db.ts` exports stay
  stable; `db.ts` now owns `openDb` + the CRUD/bulk/init-marker primitives. Schema migration was *in* scope
  precisely because `db.migrate.test.ts` (236 lines) is a strong safety net for it — unlike the deferred work.
- **`components/common/ui.tsx` → barrel** — split the 755-line kit into `dialogs.tsx` / `fields.tsx` /
  `feedback.tsx` / `badges.tsx`; `ui.tsx` is now `export *` so every `from '../common/ui'` import is
  untouched. `Modal` moved as a single unit (the one genuinely stateful component). The barrel carries a
  file-level `eslint-disable react-refresh/only-export-components`: the rule can't verify `export *` (a known
  barrel false-positive), and a barrel defines no components so it isn't a Fast-Refresh boundary anyway — the
  four component modules lint clean and remain the boundaries. (Mirrors the earlier `controls.ts` split that
  moved style *objects* off `ui.tsx` to keep that rule happy.)
- **`scheduler/allocationDrag.ts`** (+ `.test.ts`) — extracted the pure drag/resize policy from
  `AllocationBar`: `volumePreservingHours`, `computeGesture` (the dates+hours core shared by the
  pointer-commit and the reassign-target recompute), and `snappedBarGeometry` (the live-preview pixel math).
  Left in the component: the DOM hit-testing (`snapshotLanes`/`laneAt`/`setDropTarget`), the
  `updateAllocation` write, the capacity advisory, the reassign-rejection fallback, and `nudge`. New unit
  tests cover the branches a happy-path drag never hits (divide-by-zero guard, 24h clamp, `deltaDays===0`,
  move-keeps-hours, weekend-aware threading) — and **caught a wrong assumption** in the process: a *move*
  shifts the start by calendar days and adjusts the END to preserve working-day count; it does **not** snap
  the start across the weekend (only resize/`snapToWorkingDay` does).

**Deferred by design** — these are high-churn over the most behaviour-sensitive code, in exactly the spots
where the test net is weakest, so a green gate would NOT prove the extraction safe. Net-negative *now*, not
forever: revisit each as its own scoped effort, writing the characterisation test **first** (and watching it
pass against current code, so it pins real behaviour rather than encoding the new code's self-consistency).
- **Store slice-by-concern split (`useStore.ts`, 590 lines).** Slicing by concern leaves the ~27
  near-identical CRUD actions as one large slice (marginal editability win), and the helpers
  (`mutate`/`requireAccount`/`findOwned`/`updateById`) close over `set`/`get` and each other, so a split adds
  injection wiring an editor must then understand. The real risk: the "every data mutation goes through
  `mutate()`" undo invariant has **no test asserting it** — a split could silently break undo and ship green.
  *Write first:* a test that every CRUD action pushes exactly one undo step (and `redo` restores).
- **`useSchedulerViewport` hook (net-new abstraction, not a relocation).** The viewport / scroll-freeze logic
  is the most timing-sensitive code in the app — a live `useStore.getState()` read that deliberately dodges a
  documented stale closure, rAF coalescing, and a drag-end catch-up effect. **No existing test would fail** if
  the extraction reintroduced the stale closure. *Write first:* a scroll-vertically-while-dragging
  interaction test.
- **`SchedulerGrid` render component-splits.** Risks breaking `React.memo` identity → re-render regressions
  (jank, not a red test) in a virtualised grid, and every `data-testid` must survive for the 20 E2E specs.
  Low mechanical benefit — the high-value pure part (`buildSchedulerModel`) is already extracted. *Write
  first:* a row-render-count assertion.

Coverage snapshot at this decision: **91% lines / 79% branches** (439 web tests). The branch gap is the
relevant one — the deferred risks are branch / interaction / render-identity invariants that line coverage
does not capture, which is the whole reason "tests first" (not "more coverage") gates the deferred work.

## 2026-06-08 — Deploy / DB-move
- **Forge static-SPA deploy guide** added (`docs/deploy.md`): DigitalOcean droplet, `Static HTML` site, `/dist` web dir, deploy script (`npm ci --include=dev` guards NODE_ENV=production skipping devDeps), SPA `try_files` fallback for `createBrowserRouter`. Friends demo stays localStorage on purpose: independent per-browser sandboxes, refresh-safe — the server's *shared* dataset would be worse for independent play.
- **DB-move action plan** added (`docs/server-migration-plan.md`): reframes the move as a *cutover + hardening* (Phases 0/1 already done), not a build. Near-term goal = friends-demo shared dataset ON the DB (daemon + `/api` proxy + build-time `VITE_FLOATY_API` flip + Basic Auth + persistent SQLite + backups), no app code. Stages B–E (concurrency/conflict UI, real auth+isolation, Postgres) are conditional/trigger-gated. Load-bearing caveats recorded there: the flag is build-time with NO localStorage fallback (server becomes a hard dependency; rollback strands server data), optimistic concurrency needs a client conflict UI not just the env flag, and `server/` is raw `node:sqlite` (no ORM) so Postgres is a rewrite.

## 2026-06-09 — Convergence run (P1 config)
- 2026-06-09 — vite.config — added `shared/**/*.{test,spec}.ts` to test.include and `shared/src/**/*.ts` to coverage.include, generalised coverage exclude `src/**/*.test.{ts,tsx}` → `**/*.test.{ts,tsx}` so shared test files stay out of the coverage denominator; mirrors floaty-schedule (convergence run)
- 2026-06-09 — package.json — added `gate` (tsc -b && eslint . && vitest run && vite build), `test:server` (-w floaty-server), `gate:server` (type-check + test, -w floaty-server) scripts; kept existing scripts (convergence run)
- 2026-06-09 — migrate (DEC-05) — no-op: v1's shared/src/data/migrate.ts is normalize-only (asArray coercion, no ensureAccounts / no accounts[0].id / no accounts.map(a=>a.id)); the malformed-tenant-row crash exists only in diary's ensureWorkspaces, which has no analog here, so no filter/test added (convergence run)
- 2026-06-09 — CI — rewrote .github/workflows/ci.yml to call gate scripts: npm run gate + npm run gate:server + playwright install chromium + npm run e2e, replacing the individual lint/build/type-check/test steps; node-version kept at 22 for server node:sqlite (convergence run)
- 2026-06-09 — tenancy tests (P3) — added one read-side isolation test to src/store/multitenancy.test.ts proving setActiveAccount changes the in-scope rows via scopeData(data, activeAccountId); other 5 of 6 scenarios already covered (create-stamps-tenant, update/delete cross-account reject, delete-tenant-keeps-other, import-no-overwrite) — no duplicates added (convergence run)
- 2026-06-09 — README (P6 docs) — added a "Docs map" section (DECISIONS / NEEDS-INPUT / decisions-log / CODE_REVIEW / CLAUDE / user-stories/REFERENCE / server/README) and a "Green gate" section listing npm run gate / gate:server / e2e, mirroring delivery-diary's README shape; preserved existing Tech + Data-model content (convergence run)
- 2026-06-09 — CLAUDE.md + DECISIONS.md (P6 docs) — added enriched terse headers "What this is" / "Architecture in one breath" / "Load-bearing invariants" (multi-tenant by Account, two over-signals kept separate, "Utilisation" term, device-global theme/util-prefs, preset-swatch colours, forms-reject/import-repair) + NEEDS-INPUT to docs map; fixed green-gate to npm run gate (= tsc -b + eslint + vitest + vite build, NO playwright) + gate:server + e2e in BOTH digests — DECISIONS.md line 95 wrongly folded `playwright test` into the gate, matching package.json's actual `gate` script kills that drift; framed v1 as the original (schedule/diary re-target it), not a re-target itself (convergence run)
- 2026-06-09 — NEEDS-INPUT.md (P6 docs) — added a lean two-section file (Resolved by assumption: local-first default, tenant-picker≠auth, import-repairs; Genuinely open: non-blocking capacity advisory, undo/redo affordance, shared-server cutover, real auth+isolation, concurrency conflict UI, Postgres) mirroring delivery-diary/NEEDS-INPUT.md; each open item traced to a v1 source (DECISIONS.md / server-migration-plan.md), dropped a per-weekday-coverage item that bled over from schedule's CoverageTarget model (no v1 analog) (convergence run)
- 2026-06-09 — CI + gate — re-added shared-workspace type-check the CI rewrite dropped: added `npm run type-check --workspace=shared` step to ci.yml alongside gate/gate:server, and inserted it into the root `gate` script before `vite build` so a shared-only type error (e.g. DOM-global in a shared file the web app imports but the server never type-checks) can no longer slip the gate; shared/tsconfig has no DOM lib, `--workspace=shared` resolves and runs green (review-fix)

## 2026-06-09 — Cross-repo review fixes (round 2)
- 2026-06-09 — server CORS (F5) — `buildApp`'s factory default changed from fail-OPEN (`opts.corsOrigin ?? '*'`) to fail-CLOSED (`?? DEFAULT_CORS`, the localhost allow-list); `DEFAULT_CORS` is now defined+exported in app.ts and IMPORTED by index.ts (was a duplicated local const) so the factory itself is safe and the entrypoint stays the single source of the override. A wildcard now requires an EXPLICIT `corsOrigin:'*'`. Rewrote the app.test "echoes '*' by default" case into: localhost reflected + evil.test gets no ACAO header by default, and '*' echoed only when explicitly passed (review-fix-2)
- 2026-06-09 — server bind host (F4) — `app.listen` host default changed from `0.0.0.0` to `127.0.0.1` (localhost-only), overridable via new `FLOATY_HOST` env var for deliberate LAN/deploy exposure; server/README Env section documents the localhost default + the 0.0.0.0 override (review-fix-2)
- 2026-06-09 — server 500 leak (F6) — `fail()` now sends a GENERIC `{ error: 'Internal server error' }` body on the 500 branch and `console.error`s the real error server-side, instead of echoing `err.message`; the specific caller-fault 400 messages (validation / FK / constraint) are kept unchanged (review-fix-2)
- 2026-06-09 — persist banner copy (F9) — reworded the AppShell `persistError` banner from "Changes aren’t being saved — your browser storage is full or unavailable." (localStorage-only blame, wrong in server mode where a failed remote PUT trips it) to neutral "Changes aren’t being saved right now — we’ll keep retrying." No test asserted the old copy (review-fix-2)
- 2026-06-09 — isEmpty hoist (F13) — hoisted the duplicated `isEmpty(data: AppData)` into shared/src/types/entities.ts (exported next to emptyAppData); deleted the two local copies in src/data/persist.ts and server/src/db.ts and import from shared instead. db.ts re-exports it so the existing `db.migrate.test.ts` import (`isEmpty` from './db') keeps resolving (review-fix-2)
- 2026-06-09 — F1 (server-mode empty-data lockout) — N/A: v1's persist.ts has NO bootstrap lockout guard and no `isServerConfigured` import; a reachable empty server already flows to the normal empty-hydrate path (seed gate is `!existed && !!opts.seedIfEmpty`). Nothing to remove (review-fix-2)
- 2026-06-09 — F2/F7 (whole-state PUT wipe bar / FK-rollback) — N/A: v1 is entity-level, no `PUT /api/state`. The analog `POST /api/import` is already hardened against the degenerate-body clobber — `parseData` throws on `total===0` and the route only calls `replaceAccountSlice` when `result.imported > 0` (slice-replace, never a whole-state wipe) (review-fix-2)
- 2026-06-09 — F8 (false-green LOCAL-seed test) — N/A: v1 has no test that asserts only "setConnectionError was NOT called"; the nearest ("seeds an empty store") already positively asserts the seed was applied to the store AND persisted via the adapter (review-fix-2)
- 2026-06-09 — F10 (migrate junk-row hardening) — N/A: gate "if migrate can throw on junk" is NOT met. v1's migrate cannot throw on a junk row — `migrateV1toV2` guards `if (!r || typeof r !== 'object') return r` and runs only for version<2, and `normalize`/`asArray` never throw — so there's no throw to mis-route loadAll→ConnectionError. v1's `normalize` also has no `ENTITY_KEYS` filter loop like schedule's, so the schedule fix has no identical form here; a bespoke filter would diverge, not converge (matches the prior DEC-05 no-op note) (review-fix-2)
- 2026-06-09 — F3/F11/F12 — N/A (diary-only): F3 (denormalized clientId invariant) has no cross-row analog in v1; F11 (StorageRecovery "local-only / no server" false comment) — v1's StorageRecovery has no such comment; F12 (json/bool rowCodec retain decision) is a diary-specific retain call, not applicable to v1 (review-fix-2)

## 2026-06-11 — Dev-server white screen: loud binding, strict port
- 2026-06-11 — dev server (white-screen root cause) — a 5-agent investigation (full e2e 89/89 green; code audit; Chromium+WebKit load matrix on localhost/127.0.0.1/[::1]; machine forensics; cold-boot repro of `npm install && npm run dev`) proved the app has NO silent-white path once main.tsx executes (pre-hydration renders sidebar+Loading; all failures render visible recovery screens) — the only reproduction of the reported triad (white page + empty console + 0 KB storage) is a connection-level failure: browsing an address/port the single-family-bound Vite isn't answering. Two silent-mismatch sources: Node 17+ binds `localhost` to ::1 only (fixed earlier today: `host: '127.0.0.1'`), and Vite's silent port-bump to 5174 when 5173 is squatted (this repo + floaty-schedule + delivery-diary all claim 5173). Hardened vite.config.ts with `strictPort: true` so a taken port fails loudly at startup instead of serving the wrong URL silently; added a README "Run it" section (npm install / npm run dev / open the URL Vite prints / lsof to find squatters). Verified after change: picker role-assert PASS, eslint+tsc clean, e2e smoke 6/6 (dev-hardening)
- 2026-06-11 — index.html (JS-blocked fallback) — the user's white screen was REPRODUCED with javaScriptEnabled:false: the real root cause on their machine is scripts being blocked for the site (content-blocker extension allowed in incognito / per-site JS setting), which yields exactly white + empty console + 0 KB storage because nothing executes. index.html now ships a static #root placeholder ("Loading… if this doesn't go away, JavaScript isn't running…") that React replaces on mount, plus a <noscript> banner — a JS-less load is self-diagnosing instead of silent white. Verified: JS-off shows the message, JS-on renders the picker with 0 placeholder remnants, gate green, chromium e2e 85/85 (dev-hardening)
- 2026-06-11 — docs (white-screen wrap-up) — promoted the JS-less-fallback call to DECISIONS.md (UI & product: "A JS-less load is never silent white" — keep the index.html placeholder when touching that file); REFERENCE.md "Launching the app" now points at the URL Vite prints, explains the strict-port startup error, and adds a step-5 troubleshooting note for the "JavaScript isn't running" placeholder (confirmed root cause of the 2026-06-11 white-screen report: browser-level JS disabled + blocker extensions allowed in incognito); README Run-it section gains the matching JS-blocked note (docs)

## 2026-06-11 — E2E clock determinism
- 2026-06-11 — e2e (test time-drift) — 14 chromium specs (scheduler/allocation/features/filters/toolbar) failed once the real wall-clock passed the seed window: seed bars live 1–9 June 2026 (Tyler over-allocated 3–4 June) and the scheduler origin snaps to the current week's Monday with the utilisation window running forward from today, so by 2026-06-11 every seed bar + the 3–4 June over-marker had scrolled off-screen and each spec that clicks/hovers/drags a seed bar broke. Fixed in e2e/helpers.ts: `openApp()` now calls `page.clock.setFixedTime(new Date('2026-06-03T12:00:00'))` BEFORE `goto`, freezing test "today" inside the seed window; `setFixedTime` pins Date/now only (scroll/drag/popover timers keep running). No production or shared-domain change. Verified green: chromium 85/85, db-backed 4/4, eslint clean. Promoted a one-line standing note to DECISIONS.md (Testing & process) and added the E2E counterpart to the REFERENCE.md seed-date note (e2e determinism)

## 2026-06-11 — Schedule UI polish round (filter-hide default, back-buffer, pastel buttons, day grid)
- 2026-06-11 — filters — client/project filtering now HIDES non-matching resources by default (`showUnmatched` default flipped to false); "Show unallocated" opts the visible-but-dimmed staffing view back in. Promoted to DECISIONS.md; e2e + model tests + US-FIL-03/04 + REFERENCE.md updated (ui-polish)
- 2026-06-11 — scheduler timeline — added a 4-week scrollable back-buffer (`PAST_BUFFER_DAYS`, replaces `DEFAULT_ORIGIN_OFFSET_DAYS`) to the left of the focus date for default view / Today / jump-to-date / account switch; the grid now scrolls the focus date FLUSH to the left edge (recenterLeftPad removed) and carries `overscroll-x-contain`, so a leftward swipe pans into the past instead of macOS treating left-edge overscroll as browser back. Promoted to DECISIONS.md (ui-polish)
- 2026-06-11 — buttons — primary/danger Button variants restyled pastel: soft tint + per-theme coloured ink via new `--c-danger-soft` / `--c-brand-soft-ink` / `--c-danger-soft-ink` tokens (AA-checked in both themes); saturated brand-strong/danger fills were overpowering (ui-polish)
- 2026-06-11 — scheduler lanes — per-day hairline separators at fine zoom (new `--c-line-faint`, a step below the Monday week line in both themes); faint hover "+" hint in the day cell under the mouse (mouse-only, fine zoom, hidden mid-draw) advertising the existing click-to-create; Temp pill shrunk to a 9px whisper (ui-polish)
- 2026-06-11 — resources — Temp pill HIDDEN (owner call): TemporaryTag kept but rendered nowhere; employment type still captured on the form. Real freelancer/contractor/external-supplier differentiation deferred, to be designed with a future "third-party line" on the schedule (external companies' work we have no visibility of: start+end date only, per client+project, ALWAYS pinned at the bottom — FYI, not a resource). Both parked in NEEDS-INPUT.md "Parked"; US-RES-07 rewritten, US-RES-02/05/10 + stories index updated, e2e/unit tests now assert the untagged state (ui-polish)

## 2026-06-12 — Post-review hardening + owner-directed round (positioning, drift-proofing, Enter-submit, palette, calendar)
- 2026-06-12 — product — owner positioning recorded and promoted to DECISIONS.md: deliberately small SaaS — helicopter who's-busy view for small agencies with rotating freelancers; budgets/timesheets/mobile/hour-granularity are NON-goals; localStorage is demo-only with server cutover imminent, so multi-tab local-mode findings consciously waived. Full 9-dimension multi-agent review + roadmap in docs/full-review-2026-06-11.md (56b44a0)
- 2026-06-12 — shared/server — entity extension drift-proofed (review items 1–3): tables.ts column specs compile-checked against shared types (CheckColumns per table), fully-populated per-entity fixtures (shared/src/data/fixtures.ts) round-trip through the REST tests, KNOWN_KEYS/isScopedKey derive from SCOPED_KEYS, never-typed exhaustiveness on UPSERT_ORDER/CREATE_ORDER/SCOPED_ORDER/sanitize switch, missing/empty ids rejected 400 on every write path + NOT NULL ids for fresh DBs (old DBs covered by the route guard; SQLite PRAGMA can't see PK nullability so no table rebuild). Promoted to DECISIONS.md (641f063)
- 2026-06-12 — ui — "Ignore weekends" relabelled "Include weekends as working days" (owner): same stored boolean (checked = weekends are worked); stale e2e comment reworded (4f60dff)
- 2026-06-12 — ui — modals are real forms: Modal takes optional onSubmit and wraps children+footer in <form noValidate>; Save buttons are type=submit so Enter submits every dialog; AccountPicker's create section got its own form; AllocationModal's inline new-task input intercepts Enter to add-task instead of save. Promoted to DECISIONS.md (2ab569c)
- 2026-06-12 — ui — ⌘K/Ctrl+K command palette: dependency-free fuzzy scorer (src/lib/fuzzy.ts), combobox/listbox ARIA with aria-activedescendant, jumps to people (new ui.scrollToResource token mirroring recenterToken + SchedulerGrid effect), projects/clients (schedule filters), tasks/pages (navigate), today/ISO-date (goToDate). First useNavigate usage. REFERENCE.md + US-NAV-08 + e2e/palette.spec.ts (10 tests incl. axe with palette open) (7e74b66)
- 2026-06-12 — settings — account-level Calendar (owner): timezone (IANA, default GMT) + week start (Monday default, Sunday option) on Account like schedulingMode so the team shares week boundaries; todayISO(timeZone) via Intl, startOfWeekISO(date, weekStartsOn); Today snap, header week blocks, lane dividers, and form date defaults follow the active account; weekend tint stays Sat/Sun. New fields flowed through the same-day drift-proofing (auto ALTER migration, sanitizeAccount shared by import+server). REFERENCE.md + US-SET-01 + e2e/settings-calendar.spec.ts. Promoted to DECISIONS.md (97cff75)
- 2026-06-12 — gate — full suite green after the round: 604 unit (was 551), 63 server, 103 e2e (was 89; +10 palette, +4 calendar)
- 2026-06-12 — palette hardening (owner review) — ⌘K refuses to open over a dirty dialog (same dirtyForm gate as undo, existing notice channel); project/client palette selection REPLACES schedule filters via emptyFilters() instead of patching stale ones; local date check that rolled 2026-02-31 to Mar 3 replaced with the shared strict isValidISODate. +5 unit / +3 e2e; full suite 609 unit, 63 server, 106 e2e green (6619d96)
- 2026-06-12 — scheduler/settings — allocation-bar labels carry Client · Project before the task name, behind two device-global toggles (floaty/barLabelPrefs, Settings → Allocation bars, default both on); missing metadata skips its part, accessible name matches the visible label, popover unchanged. REFERENCE.md + US-SET-02 + e2e/settings-bar-labels.spec.ts (+5 unit / +2 e2e; suite 614 unit, 108 e2e green). Promoted to DECISIONS.md (5f78233)
- 2026-06-12 — ops — production plan written for the next user-testing round (docs/production-plan.md): executes the near-term cutover from server-migration-plan.md, hardened (Node 24 / no experimental flag, graceful shutdown, pino, rate limit, deep health, CSP/headers at Nginx, configurable daemon backups (FLOATY_BACKUP_DIR, OFF by default — owner call, enabled on the droplet) + restore drill, runbook) + an auth seam wired but OFF (FLOATY_AUTH=off|password|sso, requireUser preHandler, Better Auth for sessions/credentials/SSO — identity plumbing only, NOT Stage C isolation). Owner decisions listed in the plan's Phase 0 and pointed to from NEEDS-INPUT.md (169db95)
- 2026-06-12 — ops — Phase 0 production decisions made (owner): seeded + Cohesion `_input/` import at cutover; browser localStorage data treated as throwaway; per-tester Basic Auth htpasswd entries; one Account per tester; Node 24 LTS on the droplet (drop --experimental-sqlite, better-sqlite3 fallback); no Sentry this round; auth scaffold via Better Auth (owner prefers OSS libraries — provider choice stays deferred, social/OIDC is config not code). Recorded in docs/production-plan.md Phase 0; NEEDS-INPUT entry moved to Resolved (169db95)
- 2026-06-12 — ui/mobile — three owner-requested mobile affordances (NOT a reversal of the mobile-views non-goal — promoted to DECISIONS.md as "light affordances, not views"): (1) every sidebar link carries a hand-drawn stroke icon (9 new Icon names incl. the panel-left toggle glyph); (2) sidebar collapses to an icons-only rail — device-global floaty/sidebar pref via the displayPrefs read/write pattern, store field sidebarOpen, first-run default collapsed on small screens ((max-width:767px), (max-height:480px)) and open elsewhere/jsdom; rail icons are aria-hidden + tabIndex -1 and only re-open the menu (single accessible Collapse/Expand toggle with aria-expanded); (3) RotateHint — portrait-phone-only "Best in landscape" Modal (guardDirty=false), session-scoped dismissal (floaty/rotateHintDismissed), mounted in both the AccountPicker branch and the main shell, hidden whenever matchMedia is unavailable so unit/e2e desktop suites never see it. REFERENCE.md + US-NAV-09 + e2e/mobile.spec.ts (4 tests incl. an axe scan of the open hint — explicit page.emulateMedia({reducedMotion}) because describe-scoped test.use({reducedMotion}) didn't apply, + opacity-settle guard); README story index gained the missing US-NAV-08 row. Suite: 626 unit, 112 e2e green (60eb210)
- 2026-06-12 — ops — production plan upgraded to hand-off-ready task specs (owner): every change env-flagged, DEFAULT OFF (unset = today's behaviour) — flag register added (FLOATY_LOG, FLOATY_HEALTH_DEEP, FLOATY_RATE_LIMIT, FLOATY_BACKUP_*, FLOATY_AUTH with Better Auth not initialised in off mode, VITE_FLOATY_BUILD_SHA, VITE_FLOATY_FEEDBACK_MAILTO); three explicit unflagged exceptions (Node 24 pin, graceful shutdown, reset boot-guard) with rationale; per-task decision/files/OFF-guarantee/tests so tasks can go to a coding model verbatim. Plan only — no implementation started (1d3fc93)
- 2026-06-12 — server — P1.1 landed: Node 24 pinned (.nvmrc, engines root+server, CI node-version 24), NODE_OPTIONS=--experimental-sqlite dropped from every server script; gate:server green on 24 with zero ExperimentalWarnings; docs updated (READMEs, CLAUDE.md, DECISIONS.md). better-sqlite3 fallback stays pre-approved (e5b2262)
- 2026-06-12 — server — P1.2 landed: graceful shutdown — SIGTERM/SIGINT drains Fastify (app.close) before db.close then exit 0, second signal force-exits 1; createShutdownHandler unit-tested with fakes; kill -TERM on a dev run verified exit 0 (72b88b7)
- 2026-06-12 — server — P1.6 landed: boot-guard refuses FLOATY_ALLOW_RESET=1 + NODE_ENV=production (one clear line, exit 1); resetForbidden predicate unit-tested; dev/e2e untouched (941a643)
- 2026-06-12 — server — P1.3 landed: FLOATY_LOG=1 enables Fastify's bundled pino (per-request method/path/status/latency JSON) and routes 500-path errors through the request logger; OFF = today's logging byte-for-byte; logStream test seam; no new dependency (bce3aac)
- 2026-06-12 — server — P1.4 landed: FLOATY_HEALTH_DEEP=1 makes /api/health prove a trivial DB read (200 {ok,db} / 503 {ok:false}); OFF = exact current {ok:true} body the Playwright webServer probe depends on (1bc3cdd)
- 2026-06-12 — server — P1.5 landed: FLOATY_RATE_LIMIT=<n> registers @fastify/rate-limit (the round's one new runtime dep besides Better Auth later), n req/min per IP, /api/health exempt, X-Forwarded-For key only when the listen host is loopback (behind Nginx); fail-closed parse (unset/0/non-numeric = plugin not registered). Routes moved into a child plugin so the limiter's onRoute hook sees them (ce2b01e)
- 2026-06-12 — server — preflight regression caught + fixed during P1.5: the CORS onRequest hook must stay on the ROOT instance — OPTIONS matches no route and only root hooks run on the not-found path, so a child-scoped hook turned every cross-origin write preflight into a bare 404 (db-backed e2e stopped saving). Hook restored to root; OPTIONS preflight regression test added to the CORS suite, which had never covered it (ac46247)
- 2026-06-12 — client/settings — P1.7 landed: VITE_FLOATY_BUILD_SHA renders a muted Settings footer `build <sha> · server|local` (data-testid build-stamp; server/local proves the deploy is really in server mode since a build missing VITE_FLOATY_API silently reverts to localStorage); unset = today's Settings exactly. REFERENCE.md first, US-SET-03 (flag-gated), e2e asserts absence in the dev build (0cdae13)
- 2026-06-12 — gate — Phase 1 (P1.1–P1.7) complete: root gate + gate:server (81 server tests, was 63) + e2e (113, was 112; +1 build-stamp) all green on Node 24
- 2026-06-12 — server/auth — P3.1 landed: Better Auth module behind FLOATY_AUTH (default off). Storage spike PASSED — better-auth 1.6.18 runs directly on node:sqlite's DatabaseSync on Node 24 (tables user/session/account/verification in the same file, created only when mode ≠ off; NOT AppData entities, drift-proofing lists deliberately skip them; better-sqlite3 fallback not needed, removed). authFromEnv: off ⇒ null without reading BETTER_AUTH_*; password/sso require BETTER_AUTH_SECRET+URL; sso = generic OAuth2/OIDC plugin wired entirely from FLOATY_SSO_* env (provider = config, not code) (aa5f0e9)
- 2026-06-12 — server/auth — P3.2 landed: one root preHandler requireUser on /api/* except /api/health + /api/auth/* (off ⇒ demo identity {id:'demo'}, continue; password/sso ⇒ 401 sans session); thin GET /api/auth/me in EVERY mode ({authMode,user}; the 401 body carries authMode for the login screen); Better Auth handler mounted at /api/auth/* only when on. Boot refuses bad FLOATY_AUTH / missing secrets (verified live). Per-mode tests; the unchanged 81-test suite running in off mode IS the off-guarantee (92 total) (829c6d2)
- 2026-06-12 — client/auth — P3.3 landed: src/auth/ AuthProvider wraps the router (local mode = pass-through, NO fetch; server mode checks /api/auth/me once; 401 ⇒ lazy LoginScreen so better-auth stays out of the main bundle, +1.5 kB); LoginScreen = Better Auth React client (password form / Continue-with-SSO per server-reported mode — no client-side auth flag); Settings Account section + Sign out only when authMode ≠ off; sign-in/out restart the boot path (bootstrap must rerun with the cookie). REFERENCE.md + US-NAV-10 (flag-gated) (c6a6b77)
- 2026-06-12 — client/server — P3.4 landed: ServerSyncAdapter sends credentials:'include' everywhere (no-op with auth off; db-backed e2e unchanged); a 401 write surfaces via the existing persistError banner and AuthProvider's re-check swaps to the login screen — never a silent drop; CORS hook pairs reflected origins with Access-Control-Allow-Credentials: true (never with '*'). Promoted the auth posture to DECISIONS.md (Security posture) (2e1ff40)
- 2026-06-12 — e2e — P3.5 landed: third Playwright project auth-backed (server :8887 FLOATY_AUTH=password, fresh DB per boot, dev-only secret in the npm script; Vite :5373) running e2e/login.auth.spec.ts — total wall, wrong-password inline error, axe, sign-in→picker→app, Settings sign-out (838eedb)
- 2026-06-12 — gate — Phase 3 complete: root gate + gate:server (93 server tests) + e2e 115/115 green across all three projects. Known pre-existing flake noted: palette.spec.ts "project selection replaces stale schedule filters" fails ~20% under --repeat-each load at BOTH pre- and post-Phase-3 code (3/15 vs 4/15) — load-sensitive test, not a regression; rare in normal runs
- 2026-06-13 — server — P4.1 landed: online DB snapshots behind FLOATY_BACKUP_DIR (default OFF — no timer, no writes). node:sqlite's TOP-LEVEL backup(db, path) export (not a DatabaseSync method) verified on Node 24; VACUUM INTO stays the in-code fallback. floaty-<YYYYMMDD-HHmmss>.db every FLOATY_BACKUP_INTERVAL_MIN (60) + one at boot; prune to FLOATY_BACKUP_KEEP (48) oldest-first by name (lexicographic == chronological), non-snapshot files untouched; unref'd timer stopped first in the shutdown drain; lines respect FLOATY_LOG. 98 server tests (76a53d4)
- 2026-06-13 — ops — P4.2 restore drill performed locally against the real daemon: boot-snapshot → live edit → TERM → cp snapshot over FLOATY_DB + rm -f -wal/-shm sidecars (stale WAL from a crashed daemon would replay over the restore) → restart → edit gone, seed intact. Exact sequence recorded in docs/runbook.md; re-run once on the droplet before testers (runbook says so)
- 2026-06-13 — client/settings — P5.2 landed: Send-feedback mailto behind VITE_FLOATY_FEEDBACK_MAILTO (default OFF), beside the P1.7 build stamp; subject carries the stamp ("Floaty feedback — build <sha> · server") so reports arrive build-pinned. REFERENCE.md + US-SET-04 + e2e absence assertion (cc7abc4)
- 2026-06-13 — ops — P4.5 runbook landed (docs/runbook.md, one page): deploy + build-stamp verify, logs, backups, drilled restore sequence, demo reset via pre-session snapshot (P4.3 — replaces any FLOATY_ALLOW_RESET temptation, which P1.6 refuses anyway), monitoring w/ deep health (P4.4), per-tester htpasswd + Accounts (P5.1), tester briefing paragraph (P5.3), rollback = export /api/state FIRST (b442a4a)
- 2026-06-13 — gate — Phase 6 production-shaped rehearsal PASSED locally: prod build (VITE_FLOATY_API=http://127.0.0.1:4173 + BUILD_SHA baked — sha verified in the served SettingsView chunk) behind scripts/serve-dist.mjs (dist/ + same-origin /api proxy, the Nginx shape) against the daemon with the droplet flags ON (FLOATY_LOG=1 pino lines observed, FLOATY_HEALTH_DEEP=1 {ok,db:true} through the proxy, FLOATY_RATE_LIMIT=300, FLOATY_BACKUP_DIR boot snapshot observed, auth off demo identity). db-backed specs 4/4 via the FLOATY_REHEARSAL_URL-gated Playwright project (reuses *.db.spec.ts verbatim; dev webServers skipped). NODE_ENV deliberately unset locally (reset route needed; P1.6 guard separately tested). Remaining before testers: Phase 2 ops cutover, droplet restore drill, post-deploy smoke incl. phone pass (b442a4a)
- 2026-06-13 — scheduler — the "pre-existing palette flake" was a REAL race, found and fixed while gating Phase 6: a not-yet-debounced search term survived a palette filter REPLACEMENT (search '' on both sides, so the value-keyed cancel/reconcile never fired) and the 180ms timer resurrected it over the fresh filters — bogus search + empty-looking schedule. Fix: identity-keyed reconcile/cancel + a fire-time guard on the timer (effects flush after paint; under load the timer beats the cleanup). e2e went 3-4 fails per 15 runs → 20/20; supersedes the 2026-06-12 "not a regression" note — true then (it predates Phase 3), but it was a product bug, not test noise (39fb3c5)
- 2026-06-13 — gate — Phases 4–6 complete (repo side): root gate + gate:server (98) + e2e 116/116 green across chromium / db-backed / auth-backed, plus the production-shaped rehearsal 4/4. Left for the droplet: Phase 2 cutover runsheet, droplet restore drill, per-tester htpasswd + Accounts, post-deploy smoke (production-plan checklist; phone pass included)
