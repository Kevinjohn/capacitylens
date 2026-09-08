import { m } from "@/i18n";
import type { ReactNode } from "react";
import { orderedWeekdays } from "@capacitylens/shared/lib/accountWorkingDays";
import type { InternalColourMode, SchedulingMode } from "@capacitylens/shared/types/entities";
import { externalExplainer } from "../../lib/externalCopy";
import { buildLabels, buildLabelOptions } from "../../lib/metadata";
import { listAccountWorkingDays } from "../../store/selectors";
import type { StoreState } from "../../store/useStore";
import { SegmentedControl, SwitchField } from "../common/ui";
import { SettingsSection } from "./SettingsSection";
import { SettingsWorkingDaysSection } from "./SettingsWorkingDaysSection";
import { INTERNAL_COLOUR_MESSAGES, SCHEDULING_MESSAGES } from "./settingsLabels";

type UpdateSetting = (patch: Parameters<StoreState["updateAccount"]>[1]) => void;
type SettingsSchedulingSectionProps = {
  canEdit: boolean;
  schedulingMode: SchedulingMode;
  workingDayOrder: ReturnType<typeof orderedWeekdays>;
  workingDays: ReturnType<typeof listAccountWorkingDays>;
  workingDaysMinimumId: string;
  updateSetting: UpdateSetting;
  disciplinesEnabled: boolean;
  groupResourcesByEngagement: boolean;
  placeholdersEnabled: boolean;
  externalEnabled: boolean;
  showInternalProjects: boolean;
  showInternalActivities: boolean;
  inlineActivityCreateEnabled: boolean;
  internalColourMode: InternalColourMode;
  minimiseWeekends: StoreState["minimiseWeekends"];
  setMinimiseWeekends: StoreState["setMinimiseWeekends"];
  snapToWeekStart: StoreState["snapToWeekStart"];
  setSnapToWeekStart: StoreState["setSnapToWeekStart"];
  compactView: StoreState["compactView"];
  setCompactView: StoreState["setCompactView"];
};

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
        ariaLabel={m.settings_scheduling_aria()}
        value={schedulingMode}
        onChange={(value) => updateSetting({ schedulingMode: value })}
        options={buildLabelOptions(buildLabels(SCHEDULING_MESSAGES))}
        disabled={!canEdit}
      />
    </SettingsSection>
  );
}

function AccountToggleSection({
  title,
  help,
  label,
  checked,
  canEdit,
  onChange,
}: {
  title: string;
  help: ReactNode;
  label: string;
  checked: boolean;
  canEdit: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <SettingsSection title={title} help={help}>
      <div>
        <SwitchField label={label} checked={checked} onChange={onChange} disabled={!canEdit} />
      </div>
    </SettingsSection>
  );
}

function ScheduleViewSection(
  props: Pick<
    SettingsSchedulingSectionProps,
    | "minimiseWeekends"
    | "setMinimiseWeekends"
    | "snapToWeekStart"
    | "setSnapToWeekStart"
    | "compactView"
    | "setCompactView"
  >,
) {
  return (
    <SettingsSection title={m.settings_schedule_heading()} help={m.settings_schedule_intro()}>
      <div className="flex flex-col gap-3">
        <SwitchField
          label={m.settings_schedule_minimise_weekends()}
          checked={props.minimiseWeekends}
          onChange={props.setMinimiseWeekends}
        />
        <SwitchField
          label={m.settings_schedule_snap_week_start()}
          checked={props.snapToWeekStart}
          onChange={props.setSnapToWeekStart}
        />
        <SwitchField
          label={m.settings_schedule_compact_view()}
          checked={props.compactView}
          onChange={props.setCompactView}
        />
      </div>
    </SettingsSection>
  );
}

function InternalColourSection({
  canEdit,
  internalColourMode,
  updateSetting,
}: Pick<SettingsSchedulingSectionProps, "canEdit" | "internalColourMode" | "updateSetting">) {
  return (
    <SettingsSection title={m.settings_internal_colours_heading()} help={m.settings_internal_colours_intro()}>
      <SegmentedControl
        ariaLabel={m.settings_internal_colours_aria()}
        value={internalColourMode}
        onChange={(value) => updateSetting({ internalColourMode: value })}
        options={buildLabelOptions(buildLabels(INTERNAL_COLOUR_MESSAGES))}
        disabled={!canEdit}
      />
    </SettingsSection>
  );
}

function InternalVisibilitySection({
  canEdit,
  showInternalProjects,
  showInternalActivities,
  updateSetting,
}: Pick<
  SettingsSchedulingSectionProps,
  "canEdit" | "showInternalProjects" | "showInternalActivities" | "updateSetting"
>) {
  return (
    <SettingsSection title={m.settings_internal_visibility_heading()} help={m.settings_internal_visibility_intro()}>
      <div className="flex flex-col gap-3">
        <SwitchField
          label={m.settings_show_internal_projects_toggle()}
          checked={showInternalProjects}
          onChange={(next) => updateSetting({ showInternalProjects: next })}
          disabled={!canEdit}
        />
        <SwitchField
          label={m.settings_show_internal_activities_toggle()}
          checked={showInternalActivities}
          onChange={(next) => updateSetting({ showInternalActivities: next })}
          disabled={!canEdit}
        />
      </div>
    </SettingsSection>
  );
}

export function SettingsSchedulingSection(props: SettingsSchedulingSectionProps) {
  const externalHelp = (
    <>
      <span className="block">{externalExplainer()}</span>
      <span className="mt-2 block">{m.settings_external_intro()}</span>
    </>
  );
  return (
    <>
      <SchedulingModeSection {...props} />
      <SettingsWorkingDaysSection {...props} />
      <AccountToggleSection
        title={m.settings_disciplines_heading()}
        help={m.settings_disciplines_intro()}
        label={m.settings_disciplines_toggle()}
        checked={props.disciplinesEnabled}
        canEdit={props.canEdit}
        onChange={(next) => props.updateSetting({ disciplinesEnabled: next })}
      />
      <AccountToggleSection
        title={m.settings_engagement_grouping_heading()}
        help={m.settings_engagement_grouping_intro()}
        label={m.settings_engagement_grouping_toggle()}
        checked={props.groupResourcesByEngagement}
        canEdit={props.canEdit}
        onChange={(next) => props.updateSetting({ groupResourcesByEngagement: next })}
      />
      <ScheduleViewSection {...props} />
      <InternalColourSection {...props} />
      <AccountToggleSection
        title={m.settings_placeholders_heading()}
        help={m.settings_placeholders_intro()}
        label={m.settings_placeholders_toggle()}
        checked={props.placeholdersEnabled}
        canEdit={props.canEdit}
        onChange={(next) => props.updateSetting({ placeholdersEnabled: next })}
      />
      <AccountToggleSection
        title={m.settings_external_heading()}
        help={externalHelp}
        label={m.settings_external_toggle()}
        checked={props.externalEnabled}
        canEdit={props.canEdit}
        onChange={(next) => props.updateSetting({ externalEnabled: next })}
      />
      <InternalVisibilitySection {...props} />
      <AccountToggleSection
        title={m.settings_activity_create_heading()}
        help={m.settings_activity_create_intro()}
        label={m.settings_inline_activity_create_toggle()}
        checked={props.inlineActivityCreateEnabled}
        canEdit={props.canEdit}
        onChange={(next) => props.updateSetting({ inlineActivityCreateEnabled: next })}
      />
    </>
  );
}
