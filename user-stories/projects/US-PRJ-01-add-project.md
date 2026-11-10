# US-PRJ-01 — Add a project (must belong to a client)

As an Editor, I want to add a project under a client so that it can be scheduled and filtered.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Projects screen → Add project
**Documentation:** [Guide](../../docs-src/using/projects.md)
**Source:** [ProjectList.tsx](../../apps/frontend/src/components/projects/ProjectList.tsx) · [ProjectForm.tsx](../../apps/frontend/src/components/projects/ProjectForm.tsx)

## Acceptance criteria

| Field         | Control         | Required/default/conditions                                      |
| ------------- | --------------- | ---------------------------------------------------------------- |
| Name          | Text field      | Required; initially blank                                        |
| Client        | Picker          | Required; active clients and Internal                            |
| Use code name | Switch          | Owner only; off by default                                       |
| Code name     | Text field      | Owner only; required when Use code name is on                    |
| Colour        | Preset swatches | Defaults to project colour #da2d92; hidden for Internal projects |

- **Save** adds the project. Invalid required values keep the form open with an error. **Cancel** closes without saving.
