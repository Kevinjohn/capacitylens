# US-DIS-02 — Edit a discipline

As an Editor, I want to edit a discipline name or colour so that schedule group labels stay current.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Disciplines screen → discipline row → Edit
**Documentation:** [Guide](../../docs-src/using/disciplines.md)
**Source:** [DisciplineList.tsx](../../apps/frontend/src/components/disciplines/DisciplineList.tsx) · [DisciplineForm.tsx](../../apps/frontend/src/components/disciplines/DisciplineForm.tsx)

## Acceptance criteria

| Field  | Control         | Required/default/conditions       |
| ------ | --------------- | --------------------------------- |
| Name   | Text field      | Required; current value prefilled |
| Colour | Preset swatches | Current colour preselected        |

- **Save** updates the discipline and preserves its sort order. **Cancel** closes without saving.
