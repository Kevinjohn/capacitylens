# US-ALL-03 — Duplicate an allocation

As an Editor, I want to duplicate an allocation so that I can reuse its resource, activity and dates without re-entering them.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [AllocationModal.tsx](../../apps/frontend/src/components/scheduler/AllocationModal.tsx)

## Acceptance criteria

- The Edit allocation dialog shows **Duplicate** only for an allocation that is not part of a repeating series.
- **Duplicate** immediately creates a separate allocation from the form’s current values and closes the dialog; the original allocation keeps its saved values.
- An invalid form or a refused save keeps the dialog open with an error and creates no copy. Undo removes a created copy.
