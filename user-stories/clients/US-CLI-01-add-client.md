# US-CLI-01 — Add a client

As an Editor, I want to add a client with a name and preset colour so that projects can belong to it.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Clients screen → Add client
**Documentation:** [Clients and projects guide](../../docs-src/using/projects.md)
**Source:** [ClientList.tsx](../../apps/frontend/src/components/clients/ClientList.tsx) · [ClientForm.tsx](../../apps/frontend/src/components/clients/ClientForm.tsx)

## Acceptance criteria

| Field         | Control         | Required/default/conditions                   |
| ------------- | --------------- | --------------------------------------------- |
| Name          | Text field      | Required; initially blank                     |
| Use code name | Switch          | Owner only; off by default                    |
| Code name     | Text field      | Owner only; required when Use code name is on |
| Colour        | Preset swatches | Defaults to client colour #2d75da             |

- **Save** adds the client. Invalid required values keep the form open with an error. **Cancel** closes without saving.
