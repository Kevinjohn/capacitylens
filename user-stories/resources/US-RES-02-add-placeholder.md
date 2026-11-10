# US-RES-02 — Add a placeholder bound to a project

As an Editor, I want to add a placeholder bound to a project so that reserved capacity is visible before staffing.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → Placeholders → Add placeholder
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [ResourceList.tsx](../../apps/frontend/src/components/resources/ResourceList.tsx) · [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx)

## Acceptance criteria

| Field           | Control    | Required/default/conditions                                                |
| --------------- | ---------- | -------------------------------------------------------------------------- |
| Name (optional) | Text field | Optional; role may identify the placeholder                                |
| Role            | Text field | Optional                                                                   |
| Discipline      | Picker     | Shown when disciplines are enabled and at least one is available; optional |
| Bound project   | Picker     | Required; active projects                                                  |

- **Save** adds the placeholder to its project and the Placeholder section. Placeholders have no Engagement, availability-date or working-day controls.
