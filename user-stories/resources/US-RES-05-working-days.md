# US-RES-05 — Set a resource's working days

As an Editor, I want to set a person’s working days so that the schedule calculates capacity correctly.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → person row → Edit → Working days
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx) · [ResourceAvailabilityFields.tsx](../../apps/frontend/src/components/resources/ResourceAvailabilityFields.tsx)

## Acceptance criteria

| Field        | Control        | Required/default/conditions                                    |
| ------------ | -------------- | -------------------------------------------------------------- |
| Working days | Weekday picker | People only; at least one weekday must be Full day or Half day |

- **Save** retains valid values; invalid values keep the form open with an error.
