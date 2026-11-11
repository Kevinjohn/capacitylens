# US-NAV-06 — Choose appearance

As a company member, I want to choose this device’s light or dark appearance so that the interface suits my viewing conditions.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Sidebar theme action; Settings → My display

**Documentation:** [Settings](../../docs-src/using/settings.md)

**Source:** [AppSidebar.tsx](../../apps/frontend/src/components/AppSidebar.tsx); [theme.ts](../../apps/frontend/src/lib/theme.ts)

## Acceptance criteria

- Settings → My display → **Appearance on this device** offers **Light**, **Dark** and **Match system**. The sidebar action reads **Switch to light mode** or **Switch to dark mode** and switches between Light and Dark from the theme currently shown. The choice is a device preference.
- With the operating system’s reduced-motion setting, animations and transitions are effectively disabled.

## User flow

```mermaid
flowchart TD
  human1["Choose Light, Dark, or Match system in Settings"]
  human2["Appearance updates and the choice is saved on this device"]
  human3["Use sidebar action"]
  human4["toggle explicitly between Light and Dark"]
  human1 --> human2
  human1 --> human3
  human3 --> human4
```

## Code flow

```mermaid
flowchart TD
  settings["SettingsAppearanceSection onChange"] --> action["runtimeSlice setTheme"]
  sidebar["ThemeToggleMenuItem calls setTheme"] --> action
  action --> storage["writeStoredTheme saves device preference"]
  action --> dom["applyThemeToDom applies resolved theme"]
  system["subscribeToSystemScheme"] --> resolved["resolveTheme follows OS for system choice"]
```

**Code references:** [SettingsAppearanceSection.tsx](../../apps/frontend/src/components/settings/SettingsAppearanceSection.tsx); [AppSidebar.tsx](../../apps/frontend/src/components/AppSidebar.tsx); [runtimeSlice.ts](../../apps/frontend/src/store/slices/runtimeSlice.ts); [theme.ts](../../apps/frontend/src/lib/theme.ts)
