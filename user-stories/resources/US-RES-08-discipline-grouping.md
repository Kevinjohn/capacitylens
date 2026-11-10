# US-RES-08 — Group a resource under a discipline

As an Editor, I want to assign a resource to a discipline or leave it unassigned so that schedule grouping reflects the team.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → person row → Edit → Discipline
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx) · [selectors.ts](../../apps/frontend/src/store/selectors.ts)

## Acceptance criteria

- In Add/Edit person, the **Discipline** picker offers **— None —** and available disciplines.
- Saving a discipline places the resource under that discipline on Schedule; **— None —** places it in the engagement fallback group.
