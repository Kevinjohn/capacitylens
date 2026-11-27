import { m } from '@/i18n'
import { buildLabels, buildLabelOptions } from '@/lib/metadata'
import { SegmentedControl, SwitchField } from '@/components/common/ui'
import { SettingsSection } from './SettingsSection'

import type { StoreState } from '@/store/useStore'
import { BAR_LABEL_MESSAGES, THEME_MESSAGES, UTILISATION_MESSAGES } from './settingsLabels'
/** Edits this device's theme, bar-label and utilisation-display preferences. */
export function SettingsAppearanceSection({
  barLabelPrefs: barLabelPreferences,
  setBarLabelPref: setBarLabelPreference,
  utilisationPrefs: utilisationPreferences,
  setUtilisationPref: setUtilisationPreference,
  theme,
  setTheme,
  disciplinesEnabled,
}: {
  barLabelPrefs: StoreState['barLabelPrefs']
  setBarLabelPref: StoreState['setBarLabelPref']
  utilisationPrefs: StoreState['utilisationPrefs']
  setUtilisationPref: StoreState['setUtilisationPref']
  theme: StoreState['theme']
  setTheme: StoreState['setTheme']
  disciplinesEnabled: boolean
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
              onChange={(next) => setBarLabelPreference({ key: option.value, value: next })}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title={m.settings_utilisation_heading()}
        help={m.settings_utilisation_intro()}
      >
        <div className="flex flex-col gap-3">
          {buildLabelOptions(buildLabels(UTILISATION_MESSAGES))
            .filter((option) => disciplinesEnabled || option.value !== 'showDiscipline')
            .map((option) => (
              <SwitchField
                key={option.value}
                label={option.label}
                checked={utilisationPreferences[option.value]}
                onChange={(next) => setUtilisationPreference({ key: option.value, value: next })}
              />
            ))}
        </div>
      </SettingsSection>

      <SettingsSection title={m.settings_appearance_heading()} help={m.settings_appearance_intro()}>
        <SegmentedControl
          variant="recessed"
          ariaLabel={m.settings_appearance_aria()}
          value={theme}
          onChange={setTheme}
          options={buildLabelOptions(buildLabels(THEME_MESSAGES))}
          fullWidth
        />
      </SettingsSection>
    </>
  )
}
