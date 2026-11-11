# US-RES-04 — Archive a resource

As an Editor, I want to archive a resource so that it leaves active views while its work remains retained.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → resource row → Archive {resource name}
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [ResourceList.tsx](../../apps/frontend/src/components/resources/ResourceList.tsx) · [ArchivedEntitySection.tsx](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx)

## Acceptance criteria

- Selecting **Archive {name}** opens **Archive resource?** with **Archive** and **Cancel** controls.
- The dialog reads **Archive "{name}"? They will be hidden from the schedule.** and notes that Editors, Admins and Owners can restore them and only Owners and Admins can anonymise them. It shows no count of affected records.
- After confirmation, the resource leaves its active section and the Schedule. Its allocations and time off are kept, not deleted.
- **Cancel** closes the dialog without archiving. **Archive** archives the record.
- The archived record appears in its archived section with a **Restore** control.
