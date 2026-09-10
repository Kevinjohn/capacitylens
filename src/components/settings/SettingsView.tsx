import { m } from "@/i18n";
import { ListPage } from "../common/ui";
import { ImportExport } from "../ImportExport";
import { ArchivedSection } from "./ArchivedSection";
import { SecuritySection } from "./SecuritySection";
import { SettingsAccountOptions, SettingsAccountSection, SettingsBuildDetails } from "./SettingsAccountSections";
import { SettingsAppearanceSection } from "./SettingsAppearanceSection";
import { SettingsDataSection } from "./SettingsDataSection";
import { SettingsSchedulingSection } from "./SettingsSchedulingSection";
import { SettingsSection } from "./SettingsSection";
import { useSettingsViewController } from "./useSettingsViewController";

export function SettingsView() {
  const controller = useSettingsViewController();
  if (!controller.activeAccount) return null;
  const { scheduling, display, localData, auth } = controller;
  return (
    <ListPage title={m.settings_title()}>
      <div className="flex flex-col gap-6">
        <SettingsSchedulingSection
          id="getting-started-settings"
          canEdit={controller.canEdit}
          {...scheduling}
          workingDaysMinimumId={controller.workingDaysMinimumId}
          updateSetting={controller.updateSetting}
          minimiseWeekends={display.minimiseWeekends}
          setMinimiseWeekends={display.setMinimiseWeekends}
          snapToWeekStart={display.snapToWeekStart}
          setSnapToWeekStart={display.setSnapToWeekStart}
          compactView={display.compactView}
          setCompactView={display.setCompactView}
        />
        <SettingsAppearanceSection
          barLabelPrefs={display.barLabelPrefs}
          setBarLabelPref={display.setBarLabelPref}
          utilizationPrefs={display.utilizationPrefs}
          setUtilizationPref={display.setUtilizationPref}
          theme={display.theme}
          setTheme={display.setTheme}
          disciplinesEnabled={scheduling.disciplinesEnabled}
        />
        <SettingsDataSection
          serverMode={controller.serverMode}
          authMode={auth.authMode}
          user={auth.user}
          offlineEnabled={controller.offlineEnabled}
          offlineState={controller.offlineState}
          {...localData}
        />
        <SettingsAccountSection auth={auth} />
        {auth.authMode === "password" && <SecuritySection />}
        <ArchivedSection collapsible defaultOpen={false} />
        <SettingsSection
          id="getting-started-import"
          title={m.settings_data_heading()}
          help={m.settings_data_description()}
          collapsible
          defaultOpen={window.location.hash === "#getting-started-import"}
        >
          <ImportExport />
        </SettingsSection>
        <SettingsAccountOptions activeAccount={controller.activeAccount} scheduling={scheduling} />
        <SettingsBuildDetails
          serverMode={controller.serverMode}
          persistenceDiagnostics={controller.persistenceDiagnostics}
          stamp={controller.stamp}
          feedback={controller.feedback}
        />
      </div>
    </ListPage>
  );
}
