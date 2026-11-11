# US-SET-22 — Enable disciplines

As a company Editor, I want to enable disciplines so that people can be grouped by their work area.

**Status:** Current
**Access:** Owner, Admin, Editor
**Entry:** Settings → Scheduling features → Use disciplines
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx)

## Acceptance criteria

| Field           | Control | Required/default/conditions                                                          |
| --------------- | ------- | ------------------------------------------------------------------------------------ |
| Use disciplines | Switch  | Company-wide; Off in a new company; on in the sample demo. Hiding preserves records. |
