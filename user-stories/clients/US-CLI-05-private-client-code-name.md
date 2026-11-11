# US-CLI-05 — Mark a client private with a code name

As an Owner, I want to set a client code name so that non-Owners see the safe name while Owners retain the real name.

**Status:** Current
**Access:** Editor and above for ordinary fields; Owner only for privacy and code-name fields
**Entry:** Clients screen → client row → Edit (Owner only for private fields)
**Documentation:** [Clients and projects guide](../../docs-src/using/projects.md)
**Source:** [ClientList.tsx](../../apps/frontend/src/components/clients/ClientList.tsx) · [ClientForm.tsx](../../apps/frontend/src/components/clients/ClientForm.tsx)

## Acceptance criteria

| Field         | Control         | Required/default/conditions                                         |
| ------------- | --------------- | ------------------------------------------------------------------- |
| Name          | Text field      | Required; read-only for non-Owners when the client uses a code name |
| Use code name | Switch          | Owner only (anyone in demo mode); current value prefilled           |
| Code name     | Text field      | Owner only; shown and required when Use code name is on             |
| Colour        | Preset swatches | Current colour preselected                                          |

- **Save** updates the real name or code name and preset colour. Non-Owners continue to see the code name. Missing code name keeps the form open with an error. **Cancel** closes without saving.
