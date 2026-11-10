# US-ACT-05 — Restore an archived activity

As an Editor, I want to restore an archived activity so that its allocations return to active views.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Activities screen → Archived activities → Restore
**Documentation:** [Activities guide](../../docs-src/using/activities.md)
**Source:** [ActivityList.tsx](../../apps/frontend/src/components/activities/ActivityList.tsx) · [ArchivedEntitySection.tsx](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx)

## Acceptance criteria

- A directly archived activity has an accessible **Restore** control. Selecting it returns the activity to active status and active views.
- A row hidden only by an archived parent links to **Restore archived parent**; restoring the parent reveals descendants that remain active.
