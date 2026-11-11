# US-TBR-07 — Undo / Redo with ⌘Z / ⌘⇧Z

As an Editor, I want keyboard shortcuts for Undo and Redo so that I can reverse planning changes quickly while preserving text entry.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)

## Acceptance criteria

- ⌘Z / Ctrl+Z undo and ⌘⇧Z / Ctrl+Shift+Z redo planning changes.
- The shortcuts work on every app screen. They do not run while text entry, IME composition or a modal owns input, or while a form has unsaved changes.
