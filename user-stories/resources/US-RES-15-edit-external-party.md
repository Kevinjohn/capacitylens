# US-RES-15 — Edit an external party

As an Editor, I want to edit an external party’s company name and descriptor so that the team sees current collaborator details.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → External row → Edit
**Documentation:** [Resources guide](../../docs-src/using/resources.md#add-an-external-party)
**Source:** [ExternalResourceSection.tsx](../../apps/frontend/src/components/resources/ExternalResourceSection.tsx) · [ExternalForm.tsx](../../apps/frontend/src/components/external/ExternalForm.tsx)

## Acceptance criteria

| Field      | Control    | Required/default/conditions                   |
| ---------- | ---------- | --------------------------------------------- |
| Company    | Text field | Required; prefilled with current company name |
| Descriptor | Text field | Optional; prefilled with current descriptor   |

- **Save** updates the External row; **Cancel** closes the form without saving.
