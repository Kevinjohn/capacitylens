# US-PRJ-05 — Mark a project private with a code name

As an Owner, I want to set a project code name so that non-Owners see the safe name while Owners retain the real name.

**Status:** Current
**Access:** Editor and above for ordinary fields; Owner only for privacy and code-name fields
**Entry:** Projects screen → project row → Edit (Owner only for private fields)
**Documentation:** [Guide](../../docs-src/using/projects.md)
**Source:** [ProjectList.tsx](../../apps/frontend/src/components/projects/ProjectList.tsx) · [ProjectForm.tsx](../../apps/frontend/src/components/projects/ProjectForm.tsx)

## Acceptance criteria

| Field         | Control         | Required/default/conditions                                          |
| ------------- | --------------- | -------------------------------------------------------------------- |
| Client        | Picker          | Required; Internal first, then active clients by name                |
| Name          | Text field      | Required; read-only for non-Owners when the project uses a code name |
| Use code name | Switch          | Owner only (anyone in demo mode); current value prefilled            |
| Code name     | Text field      | Owner only; shown and required when Use code name is on              |
| Colour        | Preset swatches | Current colour preselected; hidden when the client is Internal       |

- **Save** updates the real name or code name. Non-Owners continue to see the code name. Missing code name keeps the form open with an error. **Cancel** closes without saving.
