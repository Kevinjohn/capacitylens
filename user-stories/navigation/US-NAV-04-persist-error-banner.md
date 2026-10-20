# US-NAV-04 — Save-failure banner

**Area:** Navigation & shell · **Persona:** Studio manager · **Linked tests:**
`apps/frontend/src/components/PlanningStatusBanner.test.tsx`, `apps/frontend/src/lib/designTokens.test.ts`

**Documentation:** [Editor guide — save failed or someone changed the same record](../../docs-src/using/editor.md#what-if-a-save-failed-or-someone-changed-the-same-record)

## Goal

See whether a planning change was confirmed, and recover safely when its canonical read fails.

## Why

An edit whose server outcome is uncertain must not be repeated blindly. A confirmed save whose
latest company data could not be read also needs a separate recovery path. The persistent warning
explains which state applies and provides read-only reconciliation or refresh actions.

## How (end-to-end)

**Precondition:** Server-backed app open with the planning controller configured for an uncertain
mutation or a confirmed mutation followed by a failed canonical read.

1. Make and save an ordinary data edit.
2. Observe the persistent banner's state-specific message.
3. For an unknown outcome, select **Check saved change** and verify it reconciles the original
   command without replaying the edit, including after a failed reconciliation read.
4. For a confirmed save with a failed canonical read, select **Refresh company data**. Also check
   the refresh action after a normal company read failure with no pending mutation.

## Acceptance criteria

- ✅ An unknown outcome says **The server could not confirm whether this change was saved. Check
  the saved change before trying it again.** and offers **Check saved change**.
- ✅ A confirmed save whose canonical read failed says **Your change was saved. The latest company
  data could not be loaded. Check it before making another change.** and offers **Refresh company data**.
- ✅ A normal company read failure with no pending mutation says **Company data could not be loaded.
  Refresh it before making another change.** and offers **Refresh company data**.
- ✅ A confirmed save offers one **Refresh company data** action; it does not show a redundant
  reconciliation button that reaches the same canonical refresh.
- ✅ An uncertain command remains classified as unknown after a failed reconciliation read, even if
  planning status is `error`.
- ✅ These controls call reconciliation or canonical refresh only; they never replay the mutation.
- ✅ Failed recovery keeps the warning visible and shows a generic failure explanation. Duplicate
  recovery clicks are blocked while a request is pending.
- ✅ Without a planning context, the existing generic persistence warning remains available.
- ✅ The normal-size destructive banner body clears WCAG AA contrast in light and dark themes.
- ✅ The app never claims an unconfirmed server edit is durable or queues it for offline replay.
