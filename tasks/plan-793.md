# Issue #793: collapse repeated months in date ranges + date style preference

Status: revision 3, reviewed, ready to implement. Base: `7392e51800d517ee5f9c59b71d50a43568f456e2` (origin/main, 2026-09-11).
Issue: https://github.com/Kevinjohn/capacitylens/issues/793 (body is the spec; this plan is the execution order).
Task navigation: none in `docs-src/reference/development.md` covers date display; paths below are complete.
Validation policy: AGENTS.md defaults (not the `tasks/plan.md` programme exception).

## Shared facts (verified at base)

- `src/lib/dateDisplay.ts` owns human date strings: `formatShortDate` ("EEE do MMM", line 22),
  `formatDayMonth` ("d MMM", 35), `formatScheduleDate` ("d MMM yyyy", 40), `formatScheduleDateRange`
  (47-55, collapses year only), `formatDayCount`, `formatInstant`, `formatInstantDate`. All take the
  date-fns locale from `readActiveDateLocale()` (`src/i18n/index.ts:34`, `en → enGB`).
- Ranges are concatenated by hand at: `src/components/scheduler/PersonScheduleEntry.tsx:19-22`,
  `src/components/scheduler/PersonScheduleSheet.tsx:35`, `src/components/scheduler/AllocationBarView.tsx:168`,
  `src/components/capacity-overview/CapacityOverviewTable.tsx:244`,
  `src/components/timeoff/CompanyClosureSection.tsx:26-31` (two `formatShortDate`, joined " – ").
- Direct date-fns `format` building a month-bearing date outside `dateDisplay.ts`: `src/components/scheduler/DateHeader.tsx:25`
  ("MMM yyyy") and `:35` ("d MMM"), `src/components/scheduler/useAllocationModalState.ts:143` ("EEE d MMM yyyy", guarded),
  `src/components/timeoff/TimeOffRepeatFields.tsx:47-49` (`formatFullDate`, "d MMM yyyy").
- Direct `format` calls that stay: day number and weekday name only, no month, so no style applies:
  `DateHeader.tsx:75` ("d"), `:78` ("EEE"), `TimeOffRepeatFields.tsx:27` ("EEEE"), `timeOffFormSubmission.ts:105` ("EEEE").
- Single-date sites that stay on existing helpers: `AllocationBar.tsx:53-55` (aria start/end),
  `AllocationBarView.tsx:175`, `AllocationScheduleFields.tsx:210-211`, `allocationDraft.ts:149`,
  `TimeOffList.tsx:91-100`.
- Device preference pattern: `src/lib/theme.ts` (string enum, `readStoredTheme`/`writeStoredTheme`,
  key `${STORAGE_KEY_PREFIX}theme`); store field + setter in `src/store/types.ts:167,257` and
  `src/store/slices/runtimeSlice.ts:59,110,156-160`; UI in `SettingsAppearanceSection.tsx:56-63`
  (`SegmentedControl` from `src/components/common/SegmentedControl.tsx`, options via
  `buildLabelOptions(buildLabels(THEME_MESSAGES))`, messages table in `settingsLabels.ts:13-17`).
- Messages: `messages/en.json:138-143` (appearance section). Any edit needs `pnpm run paraglide:compile`.
- Tests pinning range text: `src/lib/dateDisplay.test.ts:87,91`, `PersonScheduleSheet.test.tsx:50`,
  `PersonScheduleEntry.test.tsx:35`, `CapacityOverviewView.test.tsx:25`, `CapacityOverviewTable.test.tsx:121-122`,
  `TimeOffForm.repeat.test.tsx:141`, `CompanyClosureSection.test.tsx:41`, `SettingsView.test.tsx:300-316` (theme radios),
  `e2e/person-schedule.auth.spec.ts:143`, `e2e/company-closures.auth.spec.ts:103`, `e2e/capacity-overview.spec.ts:15-18`.
- Ordinal pins that must NOT change (weekday form keeps its ordinal, see Fixed decisions): `TimeOffList.test.tsx:121-242`,
  `AllocationModal.repeat.test.tsx:136-413`, `e2e/timeoff.spec.ts:62-112`, `e2e/allocation.spec.ts:94-185`.
- Settings wiring: `SettingsView.tsx:84-92` receives `display.theme`/`display.setTheme` from
  `src/components/settings/useSettingsViewController.ts:32-33` (one `useStore` selector per field).
- Stories: `user-stories/settings/US-SET-01..16` exist (`US-SET-12` is archived-deleted); next free number is `US-SET-17`.
  Index table `user-stories/README.md:209-212`; template `user-stories/TEMPLATE.md`; settings table
  `user-stories/REFERENCE.md:150`; docs `docs-src/guide/settings.md:160` (Appearance row).

## Fixed decisions (all tasks)

- Style ids and output (day number never zero-padded):

  | id                    | single    | same month       | cross month          | with year (single / same month / cross year)                                |
  | --------------------- | --------- | ---------------- | -------------------- | --------------------------------------------------------------------------- |
  | `day-month` (default) | `9 Sep`   | `9 – 14 Sep`     | `9 Sep – 14 Oct`     | `9 Sep 2026` / `9 – 14 Sep 2026` / `28 Dec 2026 – 8 Jan 2027`               |
  | `day-ordinal-month`   | `9th Sep` | `9th – 14th Sep` | `9th Sep – 14th Oct` | `9th Sep 2026` / `9th – 14th Sep 2026` / `28th Dec 2026 – 8th Jan 2027`     |
  | `month-day`           | `Sep 9`   | `Sep 9 – 14`     | `Sep 9 – Oct 14`     | `Sep 9, 2026` / `Sep 9 – 14, 2026` / `Dec 28, 2026 – Jan 8, 2027`           |
  | `month-day-ordinal`   | `Sep 9th` | `Sep 9th – 14th` | `Sep 9th – Oct 14th` | `Sep 9th, 2026` / `Sep 9th – 14th, 2026` / `Dec 28th, 2026 – Jan 8th, 2027` |

  Same-year cross-month with year: `9 Sep – 14 Oct 2026` / `Sep 9 – Oct 14, 2026`. Same start and end: single form.
  Range separator is `–` (U+2013) in every style.

- Weekday form (`formatShortDate`, `formatShortDateRange`) always carries the ordinal, in every style; the style only sets
  day/month order: `Wed 10th Jun` / `Wed Jun 10th`; ranges `Fri 5th – Mon 8th Jun` / `Fri Jun 5th – Mon 8th`,
  cross-month `Fri 5th Jun – Mon 8th Jul` / `Fri Jun 5th – Mon Jul 8th`. Today's default output is unchanged.
- One resolver: `readActiveDateStyle()` in new `src/lib/dateStyle.ts`, which reads storage on every call (a single
  `localStorage.getItem`, no module cache) and falls back to `day-month`. It is the sole source: the store initialises
  from it and the store setter writes storage then publishes. No locale input yet; a comment marks where a locale
  default is inserted later. No `en`/`enGB` literal outside `src/i18n`.
- `dateDisplay.ts` is the only module that builds a month- or year-bearing (style-sensitive) date-fns pattern; the four day/weekday-only calls above are the documented exceptions. Patterns are derived from a `DateStyleDescriptor` (`monthFirst: boolean`, `ordinal: boolean`) inside `dateDisplay.ts`; call sites never see a pattern.
- Ordinals use the date-fns `do` token with the active locale; no hand-rolled suffixes.
- Preference: type `DateStyle` (the four ids), storage key `${STORAGE_KEY_PREFIX}dateStyle`, stored value is the id string, invalid or missing → `day-month`. Device-global, never in AppData/export, not undoable (same contract as `theme`).
- Reactivity: formatters read storage via `readActiveDateStyle()`; the store field exists for the Settings control only.
  Pages that show dates remount on navigation, which is sufficient.
- Aria names in `AllocationBar.tsx:53-55` keep full start and end (no collapse).
- Machine dates (ISO inputs, exports, URLs, `formatInstant*`) unchanged.

## Order

T1 first. T2 and T3 in parallel worktrees after T1 merges. T3 owns every shared prose file (CHANGELOG, REFERENCE, docs) so T2 never touches them.

## T1: date style resolver and range helpers (lib only)

**Files:** new `src/lib/dateStyle.ts`, new `src/lib/dateStyle.test.ts`, `src/lib/dateDisplay.ts`, `src/lib/dateDisplay.test.ts`.
**Fixed:**

- `dateStyle.ts` exports: `type DateStyle`, `DATE_STYLES: readonly DateStyle[]` (order as table), `DEFAULT_DATE_STYLE`,
  `readActiveDateStyle(): DateStyle`, `writeStoredDateStyle(style): void`. Read/write mirror `theme.ts:18-38`
  including the swallow comments; key `${STORAGE_KEY_PREFIX}dateStyle`.
- `dateDisplay.ts` gains `formatDayMonthRange(start, end)`, `formatShortDateRange(start, end)`,
  `formatScheduleDateRange` (existing name, now collapses month per table), `formatMonthYear(date)` (`Sep 2026`, no style),
  `formatWeekdayScheduleDate(date)` (`Wed 9 Sep 2026` / `Wed Sep 9, 2026`, no ordinal). Existing single-date helpers follow the style.
  Every helper resolves the style once per call via `readActiveDateStyle()`.
- Module header of `dateDisplay.ts` updated: style descriptor, collapse rule and separator live here for locale work later.
  **Discretion:** descriptor field names, private helper split, pattern-building mechanics.
  **Focused tests:** `dateDisplay.test.ts` covers every cell of the style table for the range helpers plus the single helpers under each style (call `writeStoredDateStyle` in `beforeEach`, `localStorage.clear()` after); `dateStyle.test.ts` covers default, stored valid, stored invalid, storage throwing. Update the two existing pins at lines 87 and 91. `pnpm exec vitest run src/lib/dateDisplay.test.ts src/lib/dateStyle.test.ts`, `pnpm exec tsc --noEmit -p tsconfig.json`, `pnpm exec eslint src/lib`, `pnpm exec prettier --check src/lib`.
  **Done:** the exports above exist, tests green, no call site changed.

## T2: route every call site through dateDisplay

**Files:** `PersonScheduleEntry.tsx`, `PersonScheduleSheet.tsx`, `AllocationBarView.tsx`, `CapacityOverviewTable.tsx`,
`CompanyClosureSection.tsx`, `DateHeader.tsx`, `useAllocationModalState.ts`, `TimeOffRepeatFields.tsx`; tests
`PersonScheduleSheet.test.tsx`, `PersonScheduleEntry.test.tsx`, `CapacityOverviewView.test.tsx`, `CapacityOverviewTable.test.tsx`,
`TimeOffForm.repeat.test.tsx`, `CompanyClosureSection.test.tsx`, `DateHeader.test.tsx`;
`e2e/person-schedule.auth.spec.ts`, `e2e/company-closures.auth.spec.ts`, `e2e/capacity-overview.spec.ts`.
**Fixed:**

- Replace the five hand-built ranges with `formatDayMonthRange` (`CompanyClosureSection`: `formatShortDateRange`). Delete `formatCompactDateRange` in `PersonScheduleEntry.tsx`.
- `DateHeader.tsx:25` → `formatMonthYear`; `:35` → `formatDayMonth`. `useAllocationModalState.ts:143` → `formatWeekdayScheduleDate` keeping the NaN guard.
  `TimeOffRepeatFields.tsx`: delete `formatFullDate`, use `formatScheduleDate`.
- Completion check (line-scoped, tolerates nested calls): `grep -rnE 'format\(.*"[^"]*(MMM|yyyy)' src --include='*.ts' --include='*.tsx' | grep -v '\.test\.'`
  lists only `src/lib/dateDisplay.ts`. The four day/weekday-only calls in Shared facts stay as they are.
- Expected new strings: `7 Sep – 4 Oct` (unchanged), `28 Dec – 8 Jan` (unchanged), `10 – 13 Sep`, `28 Sep – 4 Oct`,
  `26 – 28 Feb 2027`, `Sat 1st – Wed 5th Aug`, e2e `10 – 11 Jun`, `Fri 5th – Mon 8th Jun`, `3 – 7 Jun`, `8 – 14 Jun`,
  `15 – 21 Jun`, `22 – 28 Jun`. The ordinal pins listed in Shared facts must still pass unchanged.
  **Discretion:** import style (`@/lib` vs relative) matches each file's existing imports.
  **Focused tests:** the seven component test files plus `TimeOffList.test.tsx` and `AllocationModal.repeat.test.tsx` (regression, unchanged);
  `pnpm exec playwright test e2e/person-schedule.auth.spec.ts e2e/company-closures.auth.spec.ts e2e/capacity-overview.spec.ts e2e/timeoff.spec.ts e2e/allocation.spec.ts` (Chromium); tsc, eslint, prettier on changed files.
  **Done:** grep condition holds, listed tests green, no prose files touched.

## T3: date style preference in Settings

**Files:** `src/store/types.ts`, `src/store/slices/runtimeSlice.ts`, `src/store/useStore.test.ts`,
`src/components/settings/settingsLabels.ts`, `SettingsAppearanceSection.tsx`, `useSettingsViewController.ts`, `SettingsView.tsx`,
`SettingsView.test.tsx`, `messages/en.json`, new `e2e/settings-date-style.spec.ts`, new `user-stories/settings/US-SET-17-date-style.md`,
`user-stories/README.md`, `user-stories/REFERENCE.md`, `docs-src/guide/settings.md`, regenerated `docs/`, `CHANGELOG.md`.
**Fixed:**

- Store: `dateStyle: DateStyle` initialised from `readActiveDateStyle()`; `setDateStyle(style)` calls `writeStoredDateStyle` then `set`. Add to the `RuntimeSlice` key union (`runtimeSlice.ts:59`).
  Controller: `useSettingsViewController.ts` selects `dateStyle` and `setDateStyle` next to `theme` (lines 32-33); `SettingsView.tsx` passes both to `SettingsAppearanceSection`.
- UI: a `SegmentedControl` under the existing Appearance section, after the theme control, `ariaLabel` = "Date format", options
  from `DATE_STYLE_MESSAGES: LabelMessages<DateStyle>` in `settingsLabels.ts`. Labels are the sample strings `9 Sep`,
  `9th Sep`, `Sep 9`, `Sep 9th`. New message keys: `settings_date_style_aria`, `settings_date_style_day_month`,
  `settings_date_style_day_ordinal_month`, `settings_date_style_month_day`, `settings_date_style_month_day_ordinal`;
  `settings_appearance_intro` extended with one sentence about the date format.
- Story US-SET-17 follows `US-SET-05` shape; Linked E2E = the new spec; add its row after `US-SET-16` in `user-stories/README.md`. E2E (T1-only surface, so it passes without T2): default radio `9 Sep` checked, pick `Sep 9`, open Time off, Bruce's first row reads `Mon Jun 8th` (today `Mon 8th Jun`, `e2e/timeoff.spec.ts:62`), reload keeps the choice.
- CHANGELOG `Unreleased`: one `Changed` line for the month collapse, one `Added` line for the preference.
- `user-stories/REFERENCE.md`: settings row (line 150) mentions date format; a device-pref paragraph near line 608 names key `capacitylens/dateStyle`.
- `docs-src/guide/settings.md:160`: extend the Appearance row; run `pnpm run docs:build` and commit `docs/`.
  **Discretion:** exact intro wording, story step text, test-id if one is needed.
  **Focused tests:** `useStore.test.ts` (new case mirroring lines 298-315 for `dateStyle`), `SettingsView.test.tsx` (new describe mirroring 300-316), the new e2e spec, `pnpm run paraglide:compile`, tsc, eslint, prettier, `pnpm run docs:build`.
  **Done:** setting round-trips through storage and the schedule, story and docs describe it, CHANGELOG updated.

## Batch validation

Merge T1+T2+T3 into an integration worktree on Node from `.nvmrc`: `pnpm run gate`, `pnpm run gate:server`, `pnpm run e2e`.
After the three PRs land: a separate assets PR recaptures `docs-src/screenshots/flows/settings_account_disclosures.jpg`
(Appearance section changed), reruns `pnpm run docs:build` and commits `docs/`, per AGENTS.md "Capture screenshots only after
every UI change in the batch has landed". No version bump unless the owner asks.
