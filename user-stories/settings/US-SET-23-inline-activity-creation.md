# US-SET-23 — Create activities inline

As a company Editor, I want to enable inline activity creation so that I can add an activity while booking work.

**Status:** Current
**Access:** Owner, Admin, Editor
**Entry:** Settings → Scheduling features → Inline activity creation
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx)

## Acceptance criteria

| Field                    | Control | Required/default/conditions                                                |
| ------------------------ | ------- | -------------------------------------------------------------------------- |
| Inline activity creation | Switch  | Company-wide; Off by default; enables Add activity in the allocation form. |
