import { m } from "@/i18n";
import type { orderedWeekdays } from "@capacitylens/shared/lib/accountWorkingDays";
import type { CapacityOverviewAccess, DateStyle, SchedulingMode } from "@capacitylens/shared/types/entities";
import { externalExplainer } from "@/lib/externalCopy";
import { buildLabels, buildLabelOptions } from "@/lib/metadata";
import type { listAccountWorkingDays } from "@/store/selectors";
import type { StoreState } from "@/store/useStore";
import { SegmentedControl, SwitchField } from "@/components/common/ui";
import { SettingsSection } from "./SettingsSection";
import { SettingsDateFormatSection } from "./SettingsDateFormatSection";
import { SettingsWorkingDaysSection } from "./SettingsWorkingDaysSection";
import { CAPACITY_OVERVIEW_ACCESS_MESSAGES, SCHEDULING_MESSAGES } from "./settingsLabels";

type UpdateSetting = (patch: Parameters<StoreState["updateAccount"]>[1]) => void;
type SettingsSchedulingSectionProps = {
  canEdit: boolean;
  canManageCapacityOverviewAccess: boolean;
  capacityOverviewAccess: CapacityOverviewAccess;
  schedulingMode: SchedulingMode;
  workingDayOrder: ReturnType<typeof orderedWeekdays>;
  workingDays: ReturnType<typeof listAccountWorkingDays>;
  workingDaysMinimumId: string;
  dateStyle: DateStyle;
  updateSetting: UpdateSetting;
  disciplinesEnabled: boolean;
  placeholdersEnabled: boolean;
  externalEnabled: boolean;
  inlineActivityCreateEnabled: boolean;
  showTaskFieldInSchedule: boolean;
};

function CapacityOverviewAccessSection({
  canManageCapacityOverviewAccess,
  capacityOverviewAccess,
  updateSetting,
}: Pick<
  SettingsSchedulingSectionProps,
  "canManageCapacityOverviewAccess" | "capacityOverviewAccess" | "updateSetting"
>) {
  return (
    <SettingsSection
      title={m.settings_capacity_overview_access_heading()}
      help={m.settings_capacity_overview_access_intro()}
    >
      <SegmentedControl
        variant="recessed"
        ariaLabel={m.settings_capacity_overview_access_aria()}
        value={capacityOverviewAccess}
        onChange={(value) => updateSetting({ capacityOverviewAccess: value })}
        options={buildLabelOptions(buildLabels(CAPACITY_OVERVIEW_ACCESS_MESSAGES))}
        disabled={!canManageCapacityOverviewAccess}
        fullWidth
        density="compact"
      />
    </SettingsSection>
  );
}

function SchedulingModeSection({
  canEdit,
  schedulingMode,
  updateSetting,
}: Pick<SettingsSchedulingSectionProps, "canEdit" | "schedulingMode" | "updateSetting">) {
  const help = (
    <>
      <p>{m.settings_scheduling_intro()}</p>
      <ul className="flex list-disc flex-col gap-1 pl-4">
        <li>
          <strong>{m.settings_scheduling_hours_strong()}</strong>
          {m.settings_scheduling_hours_rest()}
        </li>
        <li>
          <strong>{m.settings_scheduling_days_strong()}</strong>
          {m.settings_scheduling_days_rest()}
        </li>
        <li>
          <strong>{m.settings_scheduling_blocks_strong()}</strong>
          {m.settings_scheduling_blocks_rest()}
        </li>
      </ul>
    </>
  );
  return (
    <SettingsSection title={m.settings_scheduling_heading()} help={help}>
      <SegmentedControl
        variant="recessed"
        ariaLabel={m.settings_scheduling_aria()}
        value={schedulingMode}
        onChange={(value) => updateSetting({ schedulingMode: value })}
        options={buildLabelOptions(buildLabels(SCHEDULING_MESSAGES))}
        disabled={!canEdit}
        fullWidth
      />
    </SettingsSection>
  );
}

export function ScheduleViewSection(props: Pick<StoreState, "minimiseWeekends" | "setMinimiseWeekends">) {
  return (
    <SettingsSection title={m.settings_schedule_heading()} help={m.settings_schedule_intro()}>
      <div className="flex flex-col gap-3">
        <SwitchField
          label={m.settings_schedule_minimise_weekends()}
          checked={props.minimiseWeekends}
          onChange={props.setMinimiseWeekends}
        />
      </div>
    </SettingsSection>
  );
}

type CompanyFeaturesSectionProps = Pick<
  SettingsSchedulingSectionProps,
  | "canEdit"
  | "disciplinesEnabled"
  | "placeholdersEnabled"
  | "externalEnabled"
  | "inlineActivityCreateEnabled"
  | "showTaskFieldInSchedule"
  | "updateSetting"
>;

/** Every company-wide on/off option in one section, so the toggles read as one list. */
export function CompanyFeaturesSection(props: CompanyFeaturesSectionProps) {
  const { canEdit, updateSetting } = props;
  const help = (
    <>
      <p>{m.settings_company_features_intro()}</p>
      <p>{m.settings_disciplines_intro()}</p>
      <p>{m.settings_placeholders_intro()}</p>
      <p>{m.settings_external_intro()}</p>
      <p>{externalExplainer()}</p>
      <p>{m.settings_activity_create_intro()}</p>
      <p>{m.settings_task_field_intro()}</p>
    </>
  );
  return (
    <SettingsSection title={m.settings_company_features_heading()} help={help}>
      <div className="flex flex-col gap-3">
        <SwitchField
          label={m.settings_disciplines_toggle()}
          checked={props.disciplinesEnabled}
          onChange={(next) => updateSetting({ disciplinesEnabled: next })}
          disabled={!canEdit}
        />
        <SwitchField
          label={m.settings_placeholders_toggle()}
          checked={props.placeholdersEnabled}
          onChange={(next) => updateSetting({ placeholdersEnabled: next })}
          disabled={!canEdit}
        />
        <SwitchField
          label={m.settings_external_toggle()}
          checked={props.externalEnabled}
          onChange={(next) => updateSetting({ externalEnabled: next })}
          disabled={!canEdit}
        />
        <SwitchField
          label={m.settings_inline_activity_create_toggle()}
          checked={props.inlineActivityCreateEnabled}
          onChange={(next) => updateSetting({ inlineActivityCreateEnabled: next })}
          disabled={!canEdit}
        />
        <SwitchField
          label={m.settings_task_field_toggle()}
          checked={props.showTaskFieldInSchedule}
          onChange={(next) => updateSetting({ showTaskFieldInSchedule: next })}
          disabled={!canEdit}
        />
      </div>
    </SettingsSection>
  );
}

type SchedulingFoundationSectionsProps = Pick<
  SettingsSchedulingSectionProps,
  "canEdit" | "schedulingMode" | "workingDayOrder" | "workingDays" | "workingDaysMinimumId" | "updateSetting"
>;

function SchedulingFoundationSections(props: SchedulingFoundationSectionsProps) {
  return (
    <>
      <SchedulingModeSection
        canEdit={props.canEdit}
        schedulingMode={props.schedulingMode}
        updateSetting={props.updateSetting}
      />
      <SettingsWorkingDaysSection
        canEdit={props.canEdit}
        workingDayOrder={props.workingDayOrder}
        workingDays={props.workingDays}
        workingDaysMinimumId={props.workingDaysMinimumId}
        updateSetting={props.updateSetting}
      />
    </>
  );
}

type SettingsCompanySetupSectionsProps = SchedulingFoundationSectionsProps &
  Pick<SettingsSchedulingSectionProps, "canManageCapacityOverviewAccess" | "capacityOverviewAccess" | "dateStyle">;

export function SettingsCompanySetupSections(props: SettingsCompanySetupSectionsProps) {
  return (
    <>
      <SchedulingFoundationSections {...props} />
      <SettingsDateFormatSection
        canEdit={props.canEdit}
        dateStyle={props.dateStyle}
        onChange={(dateStyle) => props.updateSetting({ dateStyle })}
      />
      <CapacityOverviewAccessSection
        canManageCapacityOverviewAccess={props.canManageCapacityOverviewAccess}
        capacityOverviewAccess={props.capacityOverviewAccess}
        updateSetting={props.updateSetting}
      />
    </>
  );
}
