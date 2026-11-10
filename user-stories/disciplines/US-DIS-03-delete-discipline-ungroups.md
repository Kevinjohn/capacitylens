# US-DIS-03 — Delete a discipline (resources ungrouped, not deleted)

As an Editor, I want to remove a discipline so that its resources become ungrouped without being deleted.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Disciplines screen → discipline row → Delete {discipline name}
**Documentation:** [Guide](../../docs-src/using/disciplines.md)
**Source:** [DisciplineList.tsx](../../apps/frontend/src/components/disciplines/DisciplineList.tsx) · [ConfirmDialog.tsx](../../apps/frontend/src/components/common/dialogs.tsx)

## Acceptance criteria

- Selecting **Delete {discipline}** opens **Delete discipline?** with **Delete** and **Cancel** controls and states resources will be ungrouped, not deleted.
- **Cancel** leaves the discipline intact. **Delete** removes the discipline and clears its resource grouping; the resources remain.
- Undo restores the discipline and its resource group assignments.
