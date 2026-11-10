# US-DIS-01 — Add a discipline

As an Editor, I want to add a named, coloured discipline so that resources can be grouped on the schedule.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Disciplines screen → Add discipline
**Documentation:** [Guide](../../docs-src/using/disciplines.md)
**Source:** [DisciplineList.tsx](../../apps/frontend/src/components/disciplines/DisciplineList.tsx) · [DisciplineForm.tsx](../../apps/frontend/src/components/disciplines/DisciplineForm.tsx)

## Acceptance criteria

| Field  | Control         | Required/default/conditions           |
| ------ | --------------- | ------------------------------------- |
| Name   | Text field      | Required; initially blank             |
| Colour | Preset swatches | Defaults to discipline colour #2d75da |

- **Save** adds the discipline; its sort order is assigned automatically after existing disciplines. **Cancel** closes without saving.
