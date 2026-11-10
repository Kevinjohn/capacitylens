# US-CLI-02 — Edit a client

As an Editor, I want to edit a client name and colour so that the updated details appear wherever the client is shown.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Clients screen → client row → Edit
**Documentation:** [Clients and projects guide](../../docs-src/using/projects.md)
**Source:** [ClientList.tsx](../../apps/frontend/src/components/clients/ClientList.tsx) · [ClientForm.tsx](../../apps/frontend/src/components/clients/ClientForm.tsx)

## Acceptance criteria

| Field         | Control         | Required/default/conditions                   |
| ------------- | --------------- | --------------------------------------------- |
| Name          | Text field      | Required; current value prefilled             |
| Use code name | Switch          | Owner only; current value prefilled           |
| Code name     | Text field      | Owner only; required when Use code name is on |
| Colour        | Preset swatches | Current colour preselected                    |

- **Save** updates the client; invalid required values keep the form open with an error. **Cancel** closes without saving.
