# US-TBR-08 — Navigation re-anchors the left edge to the week start

As an Editor, I want navigation to align the Schedule with the configured week start so that week boundaries stay consistent.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Schedule (`/`)

**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)

**Source:** [SchedulerToolbar.tsx](../../apps/frontend/src/components/scheduler/SchedulerToolbar.tsx)

## Acceptance criteria

- Weeks visible, Prev, Next and Today align the timeline to the configured week start.
- Free scrolling also snaps back to the configured week start when scrolling settles.
