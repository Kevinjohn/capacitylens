# US-NAV-06 — Choose appearance

As a company member, I want to choose this device’s light or dark appearance so that the interface suits my viewing conditions.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Settings → My display

**Documentation:** [Settings](../../docs-src/using/settings.md)

**Source:** [SettingsAppearanceSection.tsx](../../apps/frontend/src/components/settings/SettingsAppearanceSection.tsx); [theme.ts](../../apps/frontend/src/lib/theme.ts)

## Acceptance criteria

- Settings → My display → **Appearance on this device** offers **Light**, **Dark** and **Match system**. The sidebar has no theme action. The choice is a device preference.
- With the operating system’s reduced-motion setting, animations and transitions are effectively disabled.

## User flow

```mermaid
flowchart TD
  human1["Choose Light, Dark, or Match system in Settings"]
  human2["Appearance updates and the choice is saved on this device"]
  human1 --> human2
```

## Code flow

```mermaid
flowchart TD
  settings["SettingsAppearanceSection onChange"] --> action["runtimeSlice setTheme"]
  action --> storage["writeStoredTheme saves device preference"]
  action --> dom["applyThemeToDom applies resolved theme"]
  system["subscribeToSystemScheme"] --> resolved["resolveTheme follows OS for system choice"]
```

**Code references:** [SettingsAppearanceSection.tsx](../../apps/frontend/src/components/settings/SettingsAppearanceSection.tsx); [runtimeSlice.ts](../../apps/frontend/src/store/slices/runtimeSlice.ts); [theme.ts](../../apps/frontend/src/lib/theme.ts)
