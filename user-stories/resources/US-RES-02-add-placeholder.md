# US-RES-02 — Add a placeholder bound to a project

As an Editor, I want to add a placeholder bound to a project so that reserved capacity is visible before staffing.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → Placeholders → Add placeholder
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [ResourceList.tsx](../../apps/frontend/src/components/resources/ResourceList.tsx) · [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx)

## Acceptance criteria

| Field           | Control    | Required/default/conditions                                                                 |
| --------------- | ---------- | ------------------------------------------------------------------------------------------- |
| Name (optional) | Text field | Optional; the role may identify the placeholder                                             |
| Role            | Text field | Optional                                                                                    |
| Discipline      | Picker     | Optional; "— None —" by default; shown when disciplines are enabled and at least one exists |
| Bound project   | Picker     | Required; active projects, labelled Client / Project                                        |

- The Placeholders section and **Add placeholder** appear only when the company enables Show placeholders. **Save** adds the placeholder, bound to its project, to the Placeholders section. Placeholders have no Engagement, availability-date or working-day controls.
