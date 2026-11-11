# US-SET-21 — Control Overview access

As an Owner or Admin, I want to control Overview access so that the page is available to the intended roles.

**Status:** Current
**Access:** Owner, Admin can change; all roles see configured access
**Entry:** Settings → Company setup → Overview access
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx)

## Acceptance criteria

| Field           | Control           | Required/default/conditions                                                             |
| --------------- | ----------------- | --------------------------------------------------------------------------------------- |
| Overview access | Segmented control | Admins, Admins & Editors, Everyone. Defaults to Admins; only Owner/Admin can change it. |
