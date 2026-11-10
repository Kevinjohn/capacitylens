# US-SET-24 — Show the Task field

As a company Editor, I want to show the Task field so that a booking can carry a short task description.

**Status:** Current
**Access:** Owner, Admin, Editor
**Entry:** Settings → Scheduling features → Show task field in schedule
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx)

## Acceptance criteria

| Field                       | Control | Required/default/conditions                                        |
| --------------------------- | ------- | ------------------------------------------------------------------ |
| Show task field in schedule | Switch  | Company-wide; Off by default; hiding preserves existing Task text. |
