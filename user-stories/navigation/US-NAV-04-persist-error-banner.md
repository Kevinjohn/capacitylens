# US-NAV-04 — Save-failure banner

**Area:** Navigation & shell · **Persona:** Studio manager · **Linked tests:**
`src/data/persist.test.ts`, `src/components/common/ui.test.tsx`, `src/lib/color.test.ts`

## Goal

See a persistent warning when a server write cannot be saved.

## Why

An edit that exists only in the current page must never look durable. A visible, persistent warning
lets the manager stop making dependent changes and understand whether retry or intervention is
required.

## How (end-to-end)

**Precondition:** Server-backed app open with the persistence adapter configured to fail a write.

1. Make and save an ordinary data edit.
2. Observe the persistent save-failure banner and surfaced error.
3. Allow a transient failure to recover and observe bounded retry clear the warning after success.
4. Exercise a conflict or oversized atomic batch and observe its specific sticky notice instead.

## Acceptance criteria

- ✅ A failed write displays the save-error banner and the underlying error is logged/surfaced.
- ✅ The normal-size destructive banner body clears WCAG AA contrast in light and dark themes.
- ✅ Transient failures retry with a bounded backoff and clear after a successful write.
- ✅ Conflicts and oversized atomic batches use specific sticky notices rather than retrying forever.
- ✅ The app never claims an unsaved server edit is durable or queues it for offline replay.
