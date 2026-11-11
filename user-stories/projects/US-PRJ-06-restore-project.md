# US-PRJ-06 — Restore an archived project

As an Editor, I want to restore an archived project so that its active work returns to the catalogue and schedule.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Projects screen → Archived projects → Restore
**Documentation:** [Projects guide](../../docs-src/using/projects.md)
**Source:** [ProjectList.tsx](../../apps/frontend/src/components/projects/ProjectList.tsx) · [ArchivedEntitySection.tsx](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx)

## Acceptance criteria

- A directly archived project has an accessible **Restore** control. Selecting it returns the project to active status and active views.
- A row hidden only by an archived parent reads **Hidden because {type} {name} is archived.** and offers **View archived parent**, which opens the parent’s archived row; restoring the parent reveals descendants that remain active. A row whose parent was permanently deleted reads **Hidden because {type} {name} is deleted.** with no link.
