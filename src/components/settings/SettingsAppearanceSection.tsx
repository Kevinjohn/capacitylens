import { m } from "@/i18n";
import { buildLabels, buildLabelOptions } from "../../lib/metadata";
import { SegmentedControl, SwitchField } from "../common/ui";
import { SettingsSection } from "./SettingsSection";

import type { StoreState } from "../../store/useStore";
import { BAR_LABEL_MESSAGES, THEME_MESSAGES, UTILIZATION_MESSAGES } from "./settingsLabels";
export function SettingsAppearanceSection({
  barLabelPrefs: barLabelPreferences,
  setBarLabelPref: setBarLabelPreference,
  utilizationPrefs: utilizationPreferences,
  setUtilizationPref: setUtilizationPreference,
  theme,
  setTheme,
  disciplinesEnabled,
}: {
  barLabelPrefs: StoreState["barLabelPrefs"];
  setBarLabelPref: StoreState["setBarLabelPref"];
  utilizationPrefs: StoreState["utilizationPrefs"];
  setUtilizationPref: StoreState["setUtilizationPref"];
  theme: StoreState["theme"];
  setTheme: StoreState["setTheme"];
  disciplinesEnabled: boolean;
}) {
  return (
    <>
      <SettingsSection title={m.settings_bar_labels_heading()} help={m.settings_bar_labels_intro()}>
        <div className="flex flex-col gap-3">
          {buildLabelOptions(buildLabels(BAR_LABEL_MESSAGES)).map((option) => (
            <SwitchField
              key={option.value}
              label={option.label}
              checked={barLabelPreferences[option.value]}
              onChange={(next) => setBarLabelPreference(option.value, next)}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={m.settings_utilisation_heading()} help={m.settings_utilisation_intro()}>
        <div className="flex flex-col gap-3">
          {/* The per-discipline figure has nothing to attach to when disciplines are off. */}
          {buildLabelOptions(buildLabels(UTILIZATION_MESSAGES))
            .filter((option) => disciplinesEnabled || option.value !== "showDiscipline")
            .map((option) => (
              <SwitchField
                key={option.value}
                label={option.label}
                checked={utilizationPreferences[option.value]}
                onChange={(next) => setUtilizationPreference(option.value, next)}
              />
            ))}
        </div>
      </SettingsSection>

      <SettingsSection title={m.settings_appearance_heading()} help={m.settings_appearance_intro()}>
        <SegmentedControl
          ariaLabel={m.settings_appearance_aria()}
          value={theme}
          onChange={setTheme}
          options={buildLabelOptions(buildLabels(THEME_MESSAGES))}
        />
      </SettingsSection>
    </>
  );
}
