# US-RES-07 — Studio or Supplementary engagement

As an Editor, I want to classify a person as Studio or Supplementary so that the roster groups them correctly.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → person row → Edit → Engagement
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx)

## Acceptance criteria

| Field      | Control          | Required/default/conditions                              |
| ---------- | ---------------- | -------------------------------------------------------- |
| Engagement | Segmented choice | People only; Studio or Supplementary; defaults to Studio |

- **Save** retains valid values; invalid values keep the form open with an error.
