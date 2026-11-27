import { useEffect } from 'react'
import { m } from '@/i18n'
import { ListPage } from '@/components/common/ui'
import { ImportExport } from '@/components/ImportExport'
import { SettingsCompanyOptions } from './SettingsCompanySections'
import { SettingsAppearanceSection } from './SettingsAppearanceSection'
import { SettingsDataSection } from './SettingsDataSection'
import {
  CompanyFeaturesSection,
  ScheduleViewSection,
  SettingsCompanySetupSections,
} from './SettingsSchedulingSection'
import { SettingsGroup } from './SettingsGroup'
import { SettingsSection } from './SettingsSection'
import { useSettingsViewModel } from './useSettingsViewModel'

type ViewModel = ReturnType<typeof useSettingsViewModel>

function useSettingsGettingStartedTarget(ready: boolean) {
  useEffect(() => {
    if (!ready) return
    const id = window.location.hash.slice(1)
    if (id !== 'getting-started-import' && id !== 'getting-started-settings') return
    const section = document.getElementById(id)
    section?.scrollIntoView({ block: 'start' })
    section?.focus({ preventScroll: true })
  }, [ready])
}

function SettingsImportSection() {
  return (
    <SettingsSection
      id="getting-started-import"
      title={m.settings_data_heading()}
      help={m.settings_data_description()}
      description={m.settings_company_data_scope()}
      collapsible
      defaultOpen={window.location.hash === '#getting-started-import'}
    >
      <ImportExport />
    </SettingsSection>
  )
}

function SettingsBottomSections({ viewModel }: { viewModel: ViewModel }) {
  const { scheduling } = viewModel
  return (
    <>
      <SettingsImportSection />
      {viewModel.activeCompany && (
        <SettingsCompanyOptions
          companyName={viewModel.activeCompany.name}
          weekStartsOn={scheduling.weekStartsOn}
          timezone={scheduling.timezone}
        />
      )}
    </>
  )
}

/** Coordinates company, scheduling, data, and security settings for the current role. */
export function SettingsView() {
  const viewModel = useSettingsViewModel()
  useSettingsGettingStartedTarget(viewModel.activeCompany !== null)
  if (!viewModel.activeCompany) return null
  const { scheduling, display } = viewModel
  return (
    <ListPage title={m.settings_title()}>
      <div className="flex flex-col gap-6">
        <SettingsGroup title={m.settings_company_setup_heading()} id="getting-started-settings">
          <SettingsCompanySetupSections
            canEdit={viewModel.canEdit}
            canManageCapacityOverviewAccess={viewModel.canManageCapacityOverviewAccess}
            {...scheduling}
            workingDaysMinimumId={viewModel.workingDaysMinimumId}
            updateSetting={viewModel.updateSetting}
          />
        </SettingsGroup>
        <SettingsGroup title={m.settings_features_heading()}>
          <CompanyFeaturesSection
            canEdit={viewModel.canEdit}
            {...scheduling}
            updateSetting={viewModel.updateSetting}
          />
        </SettingsGroup>
        <SettingsGroup title={m.settings_display_heading()}>
          <ScheduleViewSection
            minimiseWeekends={display.minimiseWeekends}
            setMinimiseWeekends={display.setMinimiseWeekends}
          />
          <SettingsAppearanceSection
            barLabelPrefs={display.barLabelPrefs}
            setBarLabelPref={display.setBarLabelPref}
            utilisationPrefs={display.utilisationPrefs}
            setUtilisationPref={display.setUtilisationPref}
            theme={display.theme}
            setTheme={display.setTheme}
            disciplinesEnabled={scheduling.disciplinesEnabled}
          />
        </SettingsGroup>
        <SettingsGroup
          title={m.settings_support_heading()}
          description={m.settings_support_description()}
        >
          <SettingsDataSection />
          <SettingsBottomSections viewModel={viewModel} />
        </SettingsGroup>
      </div>
    </ListPage>
  )
}
