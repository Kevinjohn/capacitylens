# US-NAV-04 — Server save-failure warning

**Area:** Navigation & shell · **Persona:** Studio manager · **Linked tests:**
`e2e/resilience.db.spec.ts`, `apps/frontend/src/components/AppShell.test.tsx`, `apps/frontend/src/data/planning/planningCacheController.test.ts`

**Documentation:** [When something goes wrong](../../docs-src/self-hosting/incidents.md#the-service-is-not-ready)

## Goal

See a clear warning when server data cannot be read or a write cannot be confirmed.

## Why

An unconfirmed edit must never look durable. The manager needs to know when to reload canonical
data before deciding whether to retry an action.

## How (end-to-end)

**Precondition:** Authenticated server-backed app open while a planning read or write fails.

1. If the initial planning read fails, see an unavailable alert; a client write is refused and no
   private row is published from the failed read.
2. Reload after the read recovers and see the canonical server data.
3. If a typed save has an uncertain result, see its error without automatic replay. Reload the
   authoritative state before deliberately retrying the edit.

## Acceptance criteria

- ✅ A failed planning read displays an unavailable alert and prevents a write until canonical data
  can be loaded.
- ✅ A failed or uncertain typed save surfaces an error without claiming that the edit persisted.
- ✅ Reloading after service recovery restores canonical data; an explicit retry does not duplicate
  an uncertain write.
- ✅ The app never claims an unsaved server edit is durable or queues it for offline replay.
