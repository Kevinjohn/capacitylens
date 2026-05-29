# Decisions log

A running log of judgement calls made during the autonomous build of **Floaty v1**.
Format: `date — area — decision — why`.

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
- Tests: +6 unit (util-window decoupling, modal focus stability, store `notice`/`recenterToken`, rejected-reassign notice, pointercancel abort) and +1 E2E (Today re-centre). 280 unit + 16 E2E green; verified visually (legible over-marker tint; toast copy).
