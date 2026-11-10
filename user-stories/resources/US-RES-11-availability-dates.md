# US-RES-11 — Set a person's availability dates

As an Editor, I want to set a person’s availability dates so that capacity is zero outside their available period.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → person row → Edit → Start date / End date
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx) · [ResourceAvailabilityFields.tsx](../../apps/frontend/src/components/resources/ResourceAvailabilityFields.tsx)

## Acceptance criteria

| Field      | Control    | Required/default/conditions         |
| ---------- | ---------- | ----------------------------------- |
| Start date | Date field | People only; optional and inclusive |
| End date   | Date field | People only; optional and inclusive |

- **Save** retains valid values; invalid values keep the form open with an error.
