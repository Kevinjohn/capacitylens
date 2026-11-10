# US-CLI-06 — Restore an archived client

As an Editor, I want to restore an archived client so that its active work returns to the catalogue and schedule.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Clients screen → Archived clients → Restore
**Documentation:** [Clients and projects guide](../../docs-src/using/projects.md)
**Source:** [ClientList.tsx](../../apps/frontend/src/components/clients/ClientList.tsx) · [ArchivedEntitySection.tsx](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx)

## Acceptance criteria

- A directly archived client has an accessible **Restore** control. Selecting it returns the client to active status and active views.
- A row hidden only by an archived parent links to **Restore archived parent**; restoring the parent reveals descendants that remain active.
