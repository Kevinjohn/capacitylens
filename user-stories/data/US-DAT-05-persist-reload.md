# US-DAT-05 — Keep server changes after reload

As a company member, I want saved server changes to persist after reload so that committed work remains available.

**Status:** Current
**Access:** Any authorized company member
**Entry:** Any saved planning edit
**Documentation:** [Settings](../../docs-src/using/settings.md#connection-errors)
**Source:** [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts)

## Acceptance criteria

- A committed server change remains after a reload.
- Stale writes are refused and refreshed for review; uncertain outcomes are checked before retry.
