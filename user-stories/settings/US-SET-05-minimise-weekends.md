# US-SET-05 — Minimise weekend columns

As a company member, I want to minimise weekend columns so that working days have more room on screen.

**Status:** Current
**Access:** Owner, Admin, Editor, Viewer
**Entry:** Settings → My display → Schedule on this device
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx)

## Acceptance criteria

| Field             | Control | Required/default/conditions                                                 |
| ----------------- | ------- | --------------------------------------------------------------------------- |
| Minimise weekends | Switch  | On by default; this device only. Narrows weekend columns at day-level zoom. |

## User flow

```mermaid
flowchart TD
A["Open Settings: Schedule on this device"] --> B["Switch Minimise weekends on or off"]
B --> C["Weekend columns change width without hiding dates"]
```

## Code flow

```mermaid
flowchart TD
  view["SettingsSchedulingSection renders ScheduleViewSection"] --> setter["runtimeSlice.setMinimiseWeekends updates state"]
  setter --> pref["displayPrefs writes device preference"]
  setter --> viewport["useSchedulerViewport consumes minimiseWeekends for column geometry"]
```

**Code references:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx), [runtimeSlice.ts](../../apps/frontend/src/store/slices/runtimeSlice.ts), [displayPrefs.ts](../../apps/frontend/src/lib/displayPrefs.ts), [useSchedulerViewport.ts](../../apps/frontend/src/components/scheduler/useSchedulerViewport.ts)
