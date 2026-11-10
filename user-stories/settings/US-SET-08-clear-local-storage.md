# US-SET-08 — Keep device preferences separate

As a company member, I want to keep display preferences on my device so that they do not change company data or appear in exports.

**Status:** Current
**Access:** Owner, Admin, Editor, Viewer
**Entry:** Settings → My display
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsView.tsx](../../apps/frontend/src/components/settings/SettingsView.tsx)

## Acceptance criteria

- Device display preferences stay outside company exports. Scheduling records are never browser-persisted as a failed-read fallback; there is no clear-storage action.

## User flow

```mermaid
flowchart TD
A["Open Settings: My display"] --> B["Adjust this browser's display choices"]
B --> C["Views use the choices on this device"]
C --> D["Company data and exports are unaffected"]
```

## Code flow

```mermaid
flowchart TD
  settings["SettingsAppearanceSection renders device preferences"] --> runtime["runtimeSlice setters update in-memory preference state"]
  runtime --> storage["displayPrefs writes display keys to localStorage"]
  settings --> account["SettingsView separately reads company settings through useSettingsViewController"]
  account --> company["Company writes use typedPlanningActions and sendPlanningCommand"]
```

**Code references:** [SettingsAppearanceSection.tsx](../../apps/frontend/src/components/settings/SettingsAppearanceSection.tsx), [runtimeSlice.ts](../../apps/frontend/src/store/slices/runtimeSlice.ts), [displayPrefs.ts](../../apps/frontend/src/lib/displayPrefs.ts), [useSettingsViewController.ts](../../apps/frontend/src/components/settings/useSettingsViewController.ts), [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts)
