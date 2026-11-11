# US-RES-03 — Edit a resource's fields

As an Editor, I want to edit a resource’s details so that the roster and schedule stay accurate.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → resource row → Edit
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [ResourceList.tsx](../../apps/frontend/src/components/resources/ResourceList.tsx) · [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx) · [ResourceAvailabilityFields.tsx](../../apps/frontend/src/components/resources/ResourceAvailabilityFields.tsx)

## Acceptance criteria

| Field                 | Control          | Required/default/conditions                                                                         |
| --------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| Name                  | Text field       | Current value prefilled; required for people, optional for placeholders                             |
| Role                  | Text field       | Current value prefilled; optional                                                                   |
| Discipline            | Picker           | Current value prefilled; shown when disciplines are enabled and at least one exists                 |
| Engagement            | Segmented choice | People only; current value prefilled, Studio or Supplementary                                       |
| Bound project         | Picker           | Placeholders only; current project prefilled and required                                           |
| Start date / End date | Date fields      | People only; current values prefilled; optional and inclusive; End date cannot be before Start date |
| Working days          | Weekday picker   | People only; current values prefilled; at least one weekday Full day or Half day                    |

- **Save** updates the resource with the selected kind-specific fields; invalid required values keep the form open with an error. **Cancel** closes without saving.
