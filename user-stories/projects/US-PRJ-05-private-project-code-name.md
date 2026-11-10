# US-PRJ-05 — Mark a project private with a code name

As an Owner, I want to set a project code name so that non-Owners see the safe name while Owners retain the real name.

**Status:** Current
**Access:** Editor and above for ordinary fields; Owner only for privacy and code-name fields
**Entry:** Projects screen → project row → Edit (Owner only for private fields)
**Documentation:** [Guide](../../docs-src/using/projects.md)
**Source:** [ProjectList.tsx](../../apps/frontend/src/components/projects/ProjectList.tsx) · [ProjectForm.tsx](../../apps/frontend/src/components/projects/ProjectForm.tsx)

## Acceptance criteria

| Field         | Control         | Required/default/conditions                   |
| ------------- | --------------- | --------------------------------------------- |
| Name          | Text field      | Required                                      |
| Client        | Picker          | Required; active clients and Internal         |
| Use code name | Switch          | Owner only; off by default for public records |
| Code name     | Text field      | Owner only; required when Use code name is on |
| Colour        | Preset swatches | Required; hidden for Internal projects        |

- **Save** updates the real name or code name. Non-Owners continue to see the code name. Missing code name keeps the form open with an error. **Cancel** closes without saving.
