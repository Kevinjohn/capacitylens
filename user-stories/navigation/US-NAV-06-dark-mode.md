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

The CSS uses the resolved scheme. Reduced-motion CSS responds independently to the OS motion preference.

```mermaid
flowchart TD
  read["readRuntimeInitialState loads readStoredTheme with light fallback"] --> boot["main applies theme at boot and installs watchSystemTheme"]
  control["SettingsAppearanceSection passes the selected theme to setTheme"] --> save["writeStoredTheme attempts localStorage and preserves the in-memory choice"]
  save --> paint["applyThemeToDom uses resolveTheme and sets html data-theme"]
  save --> state["Runtime store retains the selected preference"]
  boot --> paint
  boot -->|OS scheme changes| watch{"watchSystemTheme sees system selected?"}
  watch -->|yes| paint
  watch -->|no| keep["Keep the explicit scheme"]
```

**Code references:** [SettingsAppearanceSection.tsx:55](../../apps/frontend/src/components/settings/SettingsAppearanceSection.tsx#L55) · [runtimeSlice.ts:72](../../apps/frontend/src/store/slices/runtimeSlice.ts#L72) · [runtimeSlice.ts:111](../../apps/frontend/src/store/slices/runtimeSlice.ts#L111) · [main.tsx:20](../../apps/frontend/src/main.tsx#L20) · [theme.ts:25](../../apps/frontend/src/lib/theme.ts#L25) · [theme.ts:49](../../apps/frontend/src/lib/theme.ts#L49)
