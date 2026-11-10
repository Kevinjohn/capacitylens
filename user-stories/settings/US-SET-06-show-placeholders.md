# US-SET-06 — Show placeholders

As an Editor, I want to show or hide placeholders so that I can focus on the resources relevant to my plan.

**Status:** Current
**Access:** Editor and above; Viewers can read the setting.
**Entry:** Settings → Scheduling features → Show placeholders
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx)

## Acceptance criteria

| Field             | Control | Required/default/conditions                                       |
| ----------------- | ------- | ----------------------------------------------------------------- |
| Show placeholders | Switch  | Off for new companies; company-wide. Hidden records are retained. |
