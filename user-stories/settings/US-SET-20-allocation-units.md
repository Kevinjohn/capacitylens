# US-SET-20 — Choose scheduling units

As a company Editor, I want to choose scheduling units so that bookings use the company’s preferred measure.

**Status:** Current
**Access:** Owner, Admin, Editor
**Entry:** Settings → Company setup → Allocation units
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx)

## Acceptance criteria

| Field            | Control           | Required/default/conditions                                 |
| ---------------- | ----------------- | ----------------------------------------------------------- |
| Scheduling input | Segmented control | Hours, Days or Blocks; company-wide, read-only for Viewers. |
