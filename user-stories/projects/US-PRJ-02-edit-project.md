# US-PRJ-02 — Edit a project

As an Editor, I want to edit a project’s name, client and colour so that its updated details appear throughout the schedule.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Projects screen → project row → Edit
**Documentation:** [Guide](../../docs-src/using/projects.md)
**Source:** [ProjectList.tsx](../../apps/frontend/src/components/projects/ProjectList.tsx) · [ProjectForm.tsx](../../apps/frontend/src/components/projects/ProjectForm.tsx)

## Acceptance criteria

| Field         | Control         | Required/default/conditions                                                              |
| ------------- | --------------- | ---------------------------------------------------------------------------------------- |
| Name          | Text field      | Required; current value prefilled                                                        |
| Client        | Picker          | Required; active clients and Internal, plus the selected archived client when applicable |
| Use code name | Switch          | Owner only; current value prefilled                                                      |
| Code name     | Text field      | Owner only; required when Use code name is on                                            |
| Colour        | Preset swatches | Current colour preselected; hidden for Internal projects                                 |

- **Save** updates the project. Invalid required values keep the form open with an error. **Cancel** closes without saving.
