# US-TBR-06 — Undo / Redo toolbar buttons

As an Editor, I want toolbar Undo and Redo controls so that I can reverse or reapply a planning change without a keyboard shortcut.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)

## Acceptance criteria

- **Undo** and **Redo** reverse and reapply acknowledged planning changes.
- The buttons appear only for Editor or higher. Each is disabled while planning history is not ready or when it has nothing to undo or redo.
