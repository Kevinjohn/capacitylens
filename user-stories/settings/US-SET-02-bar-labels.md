# US-SET-02 — Choose allocation bar labels

As a company member, I want to choose allocation bar labels so that schedule bars show the context I need.

**Status:** Current
**Access:** Owner, Admin, Editor, Viewer
**Entry:** Settings → My display → Allocation labels on this device
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsAppearanceSection.tsx](../../apps/frontend/src/components/settings/SettingsAppearanceSection.tsx)

## Acceptance criteria

| Field             | Control | Required/default/conditions      |
| ----------------- | ------- | -------------------------------- |
| Show client name  | Switch  | On by default; this device only. |
| Show project name | Switch  | On by default; this device only. |

## User flow

```mermaid
flowchart TD
A["Open Settings: Allocation labels on this device"] --> B["Choose whether to show client and project names"]
B --> C["Schedule bars use those labels in this browser"]
```

## Code flow

```mermaid
flowchart TD
  initial["readRuntimeInitialState reads barLabelPrefs with both labels enabled by default"] --> controls["SettingsAppearanceSection renders Client and Project switches"]
  controls --> action["setBarLabelPref receives preference key and value"]
  action --> storage["writeStoredBarLabelPrefs attempts device persistence before store publication"]
  storage --> bar["buildBarLabels assembles the visible and editor label from enabled available Client and Project, then Activity"]
  scope["AllocationBar reads current projected bar names"] --> bar
  scope --> aria["Read-only accessible label uses independently built viewerLabel"]
```

**Code references:** [displayPrefs.ts:135](../../apps/frontend/src/lib/displayPrefs.ts#L135) · [runtimeSlice.ts:74](../../apps/frontend/src/store/slices/runtimeSlice.ts#L74) · [runtimeSlice.ts:124](../../apps/frontend/src/store/slices/runtimeSlice.ts#L124) · [SettingsAppearanceSection.tsx:28](../../apps/frontend/src/components/settings/SettingsAppearanceSection.tsx#L28) · [AllocationBar.tsx:155](../../apps/frontend/src/components/scheduler/AllocationBar.tsx#L155) · [AllocationBar.tsx:194](../../apps/frontend/src/components/scheduler/AllocationBar.tsx#L194)
