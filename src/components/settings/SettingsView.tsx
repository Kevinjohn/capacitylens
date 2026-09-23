import { useEffect } from "react";
import { m } from "@/i18n";
import { ListPage } from "../common/ui";
import { ImportExport } from "../ImportExport";
import { ArchivedSection } from "./ArchivedSection";
import { SettingsAccountOptions, SettingsBuildDetails, SettingsDiagnostics } from "./SettingsAccountSections";
import { SettingsAppearanceSection } from "./SettingsAppearanceSection";
import { SettingsDataSection } from "./SettingsDataSection";
import {
  ScheduleViewSection,
  SettingsCompanySetupSections,
  SchedulingFeatureSections,
} from "./SettingsSchedulingSection";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsSection } from "./SettingsSection";
import { useSettingsViewController } from "./useSettingsViewController";

type Controller = ReturnType<typeof useSettingsViewController>;

function useSettingsOnboardingTarget(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const id = window.location.hash.slice(1);
    if (id !== "getting-started-import" && id !== "getting-started-settings") return;
    const section = document.getElementById(id);
    section?.scrollIntoView({ block: "start" });
    section?.focus({ preventScroll: true });
  }, [ready]);
}

function SettingsImportSection() {
  return (
    <SettingsSection
      id="getting-started-import"
      title={m.settings_data_heading()}
      help={m.settings_data_description()}
      description={m.settings_company_data_scope()}
      collapsible
      defaultOpen={window.location.hash === "#getting-started-import"}
    >
      <ImportExport />
    </SettingsSection>
  );
}

function SettingsBottomSections({ controller }: { controller: Controller }) {
  const { scheduling } = controller;
  return (
    <>
      <ArchivedSection collapsible defaultOpen={false} />
      <SettingsImportSection />
      <SettingsAccountOptions activeAccount={controller.activeAccount} scheduling={scheduling} />
      <SettingsBuildDetails
        serverMode={controller.serverMode}
        persistenceDiagnostics={controller.persistenceDiagnostics}
        stamp={controller.stamp}
        feedback={controller.feedback}
      />
      <SettingsDiagnostics
        diagnostics={controller.diagnostics}
        diagnosticsCopyState={controller.diagnosticsCopyState}
        copyDiagnostics={controller.copyDiagnostics}
      />
    </>
  );
}

export function SettingsView() {
  const controller = useSettingsViewController();
  useSettingsOnboardingTarget(controller.activeAccount !== null);
  if (!controller.activeAccount) return null;
  const { scheduling, display, localData, auth } = controller;
  return (
    <ListPage title={m.settings_title()}>
      <div className="flex flex-col gap-6">
        <SettingsGroup
          title={m.settings_company_setup_heading()}
          description={m.settings_company_setup_description()}
          id="getting-started-settings"
        >
          <SettingsCompanySetupSections
            canEdit={controller.canEdit}
            canManageCapacityOverviewAccess={controller.canManageCapacityOverviewAccess}
            {...scheduling}
            workingDaysMinimumId={controller.workingDaysMinimumId}
            updateSetting={controller.updateSetting}
          />
        </SettingsGroup>
        <SettingsGroup title={m.settings_features_heading()} description={m.settings_features_description()}>
          <SchedulingFeatureSections
            canEdit={controller.canEdit}
            {...scheduling}
            updateSetting={controller.updateSetting}
          />
        </SettingsGroup>
        <SettingsGroup title={m.settings_display_heading()} description={m.settings_display_description()}>
          <ScheduleViewSection {...display} />
          <SettingsAppearanceSection
            barLabelPrefs={display.barLabelPrefs}
            setBarLabelPref={display.setBarLabelPref}
            utilizationPrefs={display.utilizationPrefs}
            setUtilizationPref={display.setUtilizationPref}
            theme={display.theme}
            setTheme={display.setTheme}
            disciplinesEnabled={scheduling.disciplinesEnabled}
          />
        </SettingsGroup>
        <SettingsGroup title={m.settings_support_heading()} description={m.settings_support_description()}>
          <SettingsDataSection
            serverMode={controller.serverMode}
            authMode={auth.authMode}
            user={auth.user}
            offlineEnabled={controller.offlineEnabled}
            offlineState={controller.offlineState}
            {...localData}
          />
          <SettingsBottomSections controller={controller} />
        </SettingsGroup>
      </div>
    </ListPage>
  );
}
