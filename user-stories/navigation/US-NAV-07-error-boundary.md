# US-NAV-07 — Recoverable error screen instead of a blank page

**Area:** Navigation & shell · **Persona:** Studio manager · **Linked E2E:** `e2e/navigation.spec.ts` → "an unexpected render error shows a recoverable Something went wrong screen"

## Goal
If an unexpected render error occurs, see a clear "Something went wrong" screen with a
working **Reload** button — never a silent blank page.

## Why
A blank white page on a crash gives a manager nowhere to go and no idea what happened.
A top-level error boundary turns any uncaught render error into a recoverable screen:
the error message is shown, and one button restarts the app cleanly.

## How (end-to-end)
**Precondition:** Seeded app open. A human can't naturally crash a render, so this is
primarily covered by the linked automated test, which renders a child that throws
(the canonical mechanism is in `src/components/common/ErrorBoundary.test.tsx`: a `Boom`
component that does `throw new Error('boom')`).

**To verify manually:** temporarily add `throw new Error('manual crash')` to the top of
a rendered component (e.g. `SchedulerGrid`), save, and load that screen.
1. The normal screen does not render; instead the error screen appears.
2. It shows the heading **"Something went wrong"** and, below it, the thrown error's
   message text.
3. A **Reload** button is present.
4. Click **Reload** — the page reloads (remove the injected `throw` first so the app
   comes back up).

## Acceptance criteria
- ✅ An uncaught render error shows the **"Something went wrong"** screen, not a blank page.
- ✅ The screen displays the thrown error's message.
- ✅ A **Reload** button (`role="button"`, name "Reload") is present and reloads the app
  when clicked.
- ✅ When no error is thrown, children render normally (the boundary is invisible).
