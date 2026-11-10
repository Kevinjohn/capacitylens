# US-RES-13 — Restore an archived resource

As an Editor, I want to restore an archived resource so that it returns to active resource views.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner); only Owner/Admin see full inactive data
**Entry:** Resources screen → archived resource row → Restore
**Documentation:** [Resources guide](../../docs-src/using/resources.md)
**Source:** [ResourceList.tsx](../../apps/frontend/src/components/resources/ResourceList.tsx) · [ArchivedEntitySection.tsx](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx)

## Acceptance criteria

- A directly archived resource has an accessible **Restore** control. Selecting it returns the resource to active status and active views.
- A row hidden only by an archived parent links to **Restore archived parent**; restoring the parent reveals descendants that remain active.
