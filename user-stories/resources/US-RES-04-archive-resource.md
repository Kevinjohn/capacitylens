# US-RES-04 — Archive a resource

As an Editor, I want to archive a resource so that it leaves active views while its work remains retained.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → resource row → Archive {resource name}
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [ResourceList.tsx](../../apps/frontend/src/components/resources/ResourceList.tsx) · [ArchivedEntitySection.tsx](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx)

## Acceptance criteria

- Selecting **Archive {name}** opens **Archive resource?** with **Archive** and **Cancel** controls.
- After confirmation, the resource leaves its active section. Its allocations and time off remain retained; when allocations exist, the dialog states their count.
- **Cancel** closes the dialog without archiving. **Archive** archives the record.
- The archived record appears in its archived section with a **Restore** control.
