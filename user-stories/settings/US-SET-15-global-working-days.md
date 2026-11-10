# US-SET-15 — Set company working days

As a company Editor, I want to set company working days so that capacity reflects our shared work week.

**Status:** Current
**Access:** Owner, Admin, Editor
**Entry:** Settings → Company setup → Company-wide working days
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsWorkingDaysSection.tsx](../../apps/frontend/src/components/settings/SettingsWorkingDaysSection.tsx)

## Acceptance criteria

| Field         | Control            | Required/default/conditions                                        |
| ------------- | ------------------ | ------------------------------------------------------------------ |
| Monday–Sunday | Weekday checkboxes | Company-wide; at least one remains checked. Read-only for Viewers. |

- Changes apply immediately; existing booking dates remain in place.
