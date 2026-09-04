import { m } from "@/i18n";
import { labelsFrom, toOptions } from "../../lib/metadata";
import { SegmentedControl, SwitchField } from "../common/ui";
import { SettingsSection } from "./SettingsSection";

import type { StoreState } from "../../store/useStore";
import { BAR_LABEL_MESSAGES, THEME_MESSAGES, UTILIZATION_MESSAGES } from "./settingsLabels";
export function SettingsAppearanceSection({
  barLabelPrefs,
  setBarLabelPref,
  utilizationPrefs,
  setUtilizationPref,
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
          {toOptions(labelsFrom(BAR_LABEL_MESSAGES)).map((opt) => (
            <SwitchField
              key={opt.value}
              label={opt.label}
              checked={barLabelPrefs[opt.value]}
              onChange={(next) => setBarLabelPref(opt.value, next)}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={m.settings_utilisation_heading()} help={m.settings_utilisation_intro()}>
        <div className="flex flex-col gap-3">
          {/* The per-discipline figure has nothing to attach to when disciplines are off. */}
          {toOptions(labelsFrom(UTILIZATION_MESSAGES))
            .filter((opt) => disciplinesEnabled || opt.value !== "showDiscipline")
            .map((opt) => (
              <SwitchField
                key={opt.value}
                label={opt.label}
                checked={utilizationPrefs[opt.value]}
                onChange={(next) => setUtilizationPref(opt.value, next)}
              />
            ))}
        </div>
      </SettingsSection>

      <SettingsSection title={m.settings_appearance_heading()} help={m.settings_appearance_intro()}>
        <SegmentedControl
          ariaLabel={m.settings_appearance_aria()}
          value={theme}
          onChange={setTheme}
          options={toOptions(labelsFrom(THEME_MESSAGES))}
        />
      </SettingsSection>
    </>
  );
}
