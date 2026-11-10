# US-RES-01 — Add a person resource

As an Editor, I want to add a person with a role, working pattern and optional team details so that the schedule reflects their capacity.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → Add resource
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [ResourceList.tsx](../../apps/frontend/src/components/resources/ResourceList.tsx) · [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx)

## Acceptance criteria

| Field        | Control          | Required/default/conditions                                                                                           |
| ------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| Name         | Text field       | Required                                                                                                              |
| Role         | Text field       | Optional                                                                                                              |
| Discipline   | Picker           | Shown when disciplines are enabled and at least one is available; optional                                            |
| Engagement   | Segmented choice | Studio or Supplementary; defaults to Studio                                                                           |
| Start date   | Date field       | Optional; unbounded when blank                                                                                        |
| End date     | Date field       | Optional; unbounded when blank                                                                                        |
| Working days | Weekday picker   | Monday–Friday default Full day; other weekdays default Not working; at least one weekday must be Full day or Half day |

- **Save** adds the person to the People list; valid values are retained.
