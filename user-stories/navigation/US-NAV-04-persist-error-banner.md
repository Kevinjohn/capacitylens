# US-NAV-04 — Save-failure banner

**Area:** Navigation & shell · **Persona:** Studio manager · **Linked tests:**
`src/data/persist.test.ts`, `src/components/common/ui.test.tsx`, `src/lib/color.test.ts`

## Goal

See a persistent warning when a server write cannot be saved.

## Acceptance

- A failed write displays the save-error banner and the underlying error is logged/surfaced.
- The normal-size destructive banner body clears WCAG AA contrast in light and dark themes.
- Transient failures retry with a bounded backoff and clear after a successful write.
- Conflicts and over-sized atomic batches use specific sticky notices rather than retrying forever.
- The app never claims an unsaved server edit is durable or queues it for offline replay.
