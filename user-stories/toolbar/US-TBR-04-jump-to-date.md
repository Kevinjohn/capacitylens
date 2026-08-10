# US-TBR-04 — Jump to a specific date (hidden from the toolbar — #173)

> **⏸ Not manually testable through the UI — the toolbar no longer renders the Jump to date
> picker.** DECISION (#173): people rarely look far ahead, and a month list is probably the
> better affordance for that need — that redesign is deferred, so rather than delete the control
> the toolbar simply stops rendering it (`SHOW_JUMP_TO_DATE` in
> `src/components/scheduler/SchedulerToolbar.tsx`). The component itself
> (`src/components/scheduler/JumpToDateInput.tsx`) and the `goToDate` store action are unchanged
> and stay one flip away from returning.

**Area:** Toolbar · **Persona:** Studio manager · **Linked E2E:** `e2e/toolbar.spec.ts` → "does not expose the jump-to-date picker" · **Coverage:** `src/components/scheduler/JumpToDateInput.test.tsx` (component: shows the current focus date, moves the grid to a valid date, rejects a malformed date) + the `goToDate` tests in `src/store/useStore.test.ts` (week-start snap behaviour, including the non-Monday `weekStartsOn` regression case).

## Goal

Move the timeline to a specific date using the **Jump to date** picker (as previously exposed).

## Why

The seed bars live in the current week (shifted there at runtime by `seedForCurrentWeek`), so the
grid opening on **Today** already lands a manager on the work that matters most of the time. The
picker's one remaining job — reaching a date weeks or months out — is rare enough that it wasn't
worth the toolbar space it took, and a future month-list affordance is likely to replace it
outright. Keeping the code (rather than deleting it) means that swap is a rendering change, not a
rebuild.

## How (not executable in the current build)

The steps below describe the intended behaviour if the picker is re-surfaced.

1. Open the **Schedule**. The toolbar shows a **Jump to date** input holding the current focus date.
2. Type `2026-09-10` into it. The grid re-anchors on the week containing that date (week-start snap — see **US-TBR-08**).
3. Type a malformed value such as `2026-2-30`. The grid does not move.

A manual tester on the current build has no UI path to a specific far-future or far-past date.
To reach nearby weeks, use **Today** (re-centres on the current week — see **US-TBR-03**) or
**Prev** / **Next** (one week at a time — see **US-TBR-02**). To exercise the picker's own logic
(value display, valid/invalid date handling, and the week-start snap), run the automated coverage
listed above — it renders `JumpToDateInput` directly rather than through the toolbar.

## Acceptance criteria

- ✅ The Schedule toolbar (`data-testid="scheduler-toolbar"`) does not render a **Jump to date** input or any date-picker control.
- ✅ `JumpToDateInput.tsx` and the `goToDate` store action remain in the codebase, are still exercised by their own tests, and are not called from `SchedulerToolbar.tsx` (gated behind `SHOW_JUMP_TO_DATE = false`).
- ✅ Setting `SHOW_JUMP_TO_DATE` to `true` restores the picker with its prior behaviour, including the week-start re-anchoring described in **US-TBR-08**.

> See **US-TBR-08** for the week-start re-anchoring that still applies to **Weeks visible** / Prev-Next / Today.
