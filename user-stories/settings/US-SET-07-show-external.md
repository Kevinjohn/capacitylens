# US-SET-07 — Show external resources

As an Editor, I want to show or hide external resources so that I can focus on the work my company manages.

**Status:** Current
**Access:** Editor and above; Viewers can read the setting.
**Entry:** Settings → Scheduling features → Show external resources
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx)

## Acceptance criteria

| Field                   | Control | Required/default/conditions                                       |
| ----------------------- | ------- | ----------------------------------------------------------------- |
| Show external resources | Switch  | Off for new companies; company-wide. Hidden records are retained. |
