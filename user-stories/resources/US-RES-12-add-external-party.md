# US-RES-12 — Add an external party

As an Editor, I want to add an external party so that collaborators without capacity can be listed for the team.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → External section → Add external party
**Documentation:** [Resources guide](../../docs-src/using/resources.md)
**Source:** [ExternalResourceSection.tsx](../../apps/frontend/src/components/resources/ExternalResourceSection.tsx) · [ExternalForm.tsx](../../apps/frontend/src/components/external/ExternalForm.tsx)

## Acceptance criteria

| Field      | Control    | Required/default/conditions |
| ---------- | ---------- | --------------------------- |
| Company    | Text field | Required                    |
| Descriptor | Text field | Optional                    |

- **Save** adds the external party to the External section. External parties have no schedule capacity.
