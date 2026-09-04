import { m } from "@/i18n";
import { orderedWeekdays } from "@capacitylens/shared/lib/accountWorkingDays";
import type { InternalColourMode, SchedulingMode } from "@capacitylens/shared/types/entities";
import { externalExplainer } from "../../lib/externalCopy";
import { labelsFrom, toOptions } from "../../lib/metadata";
import { weekdayLabel, weekdayShortLabel } from "../../lib/weekdays";
import { accountWorkingDaysFor } from "../../store/selectors";
import { SegmentedControl, SwitchField } from "../common/ui";
import { Checkbox } from "../ui/checkbox";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "../ui/field";
import { SettingsSection } from "./SettingsSection";

import type { StoreState } from "../../store/useStore";
import { INTERNAL_COLOUR_MESSAGES, SCHEDULING_MESSAGES } from "./settingsLabels";
export function SettingsSchedulingSection({
  canEdit,
  schedulingMode,
  workingDayOrder,
  workingDays,
  workingDaysMinimumId,
  updateSetting,
  disciplinesEnabled,
  groupResourcesByEngagement,
  placeholdersEnabled,
  externalEnabled,
  showInternalProjects,
  showInternalActivities,
  inlineActivityCreateEnabled,
  internalColourMode,
  minimiseWeekends,
  setMinimiseWeekends,
  snapToWeekStart,
  setSnapToWeekStart,
  compactView,
  setCompactView,
}: {
  canEdit: boolean;
  schedulingMode: SchedulingMode;
  workingDayOrder: ReturnType<typeof orderedWeekdays>;
  workingDays: ReturnType<typeof accountWorkingDaysFor>;
  workingDaysMinimumId: string;
  updateSetting: (patch: Parameters<StoreState["updateAccount"]>[1]) => void;
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
}) {
  return (
    <>
      <SettingsSection
        title={m.settings_scheduling_heading()}
        help={
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
        }
      >
        <SegmentedControl
          ariaLabel={m.settings_scheduling_aria()}
          value={schedulingMode}
          onChange={(value) => updateSetting({ schedulingMode: value })}
          options={toOptions(labelsFrom(SCHEDULING_MESSAGES))}
          disabled={!canEdit}
        />
      </SettingsSection>

      <SettingsSection
        title={m.settings_working_days_heading()}
        help={
          <>
            <p>{m.settings_working_days_intro()}</p>
            <p>{m.settings_working_days_impact()}</p>
          </>
        }
      >
        <FieldSet>
          <FieldLegend variant="label" className="sr-only">
            {m.settings_working_days_legend()}
          </FieldLegend>
          <table aria-label={m.settings_working_days_legend()} className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                {workingDayOrder.map((day) => (
                  <th key={day} scope="col" className="px-1 pb-2 text-center text-sm font-medium">
                    {weekdayShortLabel(day)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {workingDayOrder.map((day) => {
                  const id = `account-working-day-${day}`;
                  const checked = workingDays.includes(day);
                  // Live-disable rather than submit-time validation (the resource form's
                  // strategy for the same min-one rule): this table saves per toggle, so a
                  // refused click must be impossible, not rejected after it appears to save.
                  const isOnlyWorkingDay = checked && workingDays.length === 1;
                  return (
                    <td key={day} className="px-1 text-center">
                      <Field
                        orientation="horizontal"
                        data-disabled={!canEdit || isOnlyWorkingDay || undefined}
                        className="justify-center gap-0"
                      >
                        <Checkbox
                          id={id}
                          checked={checked}
                          disabled={!canEdit || isOnlyWorkingDay}
                          aria-describedby={isOnlyWorkingDay ? workingDaysMinimumId : undefined}
                          onCheckedChange={() =>
                            updateSetting({
                              workingDays: checked
                                ? workingDays.filter((candidate) => candidate !== day)
                                : [...workingDays, day].sort((a, b) => a - b),
                            })
                          }
                        />
                        <FieldLabel htmlFor={id} className="sr-only">
                          {weekdayLabel(day)}
                        </FieldLabel>
                      </Field>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
          {workingDays.length === 1 && (
            <FieldDescription id={workingDaysMinimumId}>{m.settings_working_days_min_one()}</FieldDescription>
          )}
        </FieldSet>
      </SettingsSection>

      <SettingsSection title={m.settings_disciplines_heading()} help={m.settings_disciplines_intro()}>
        <div>
          <SwitchField
            label={m.settings_disciplines_toggle()}
            checked={disciplinesEnabled}
            onChange={(next) => updateSetting({ disciplinesEnabled: next })}
            disabled={!canEdit}
          />
        </div>
      </SettingsSection>

      <SettingsSection title={m.settings_engagement_grouping_heading()} help={m.settings_engagement_grouping_intro()}>
        <div>
          <SwitchField
            label={m.settings_engagement_grouping_toggle()}
            checked={groupResourcesByEngagement}
            onChange={(next) => updateSetting({ groupResourcesByEngagement: next })}
            disabled={!canEdit}
          />
        </div>
      </SettingsSection>

      <SettingsSection title={m.settings_schedule_heading()} help={m.settings_schedule_intro()}>
        <div className="flex flex-col gap-3">
          <SwitchField
            label={m.settings_schedule_minimise_weekends()}
            checked={minimiseWeekends}
            onChange={setMinimiseWeekends}
          />
          <SwitchField
            label={m.settings_schedule_snap_week_start()}
            checked={snapToWeekStart}
            onChange={setSnapToWeekStart}
          />
          <SwitchField label={m.settings_schedule_compact_view()} checked={compactView} onChange={setCompactView} />
        </div>
      </SettingsSection>

      <SettingsSection title={m.settings_internal_colours_heading()} help={m.settings_internal_colours_intro()}>
        <SegmentedControl
          ariaLabel={m.settings_internal_colours_aria()}
          value={internalColourMode}
          onChange={(value) => updateSetting({ internalColourMode: value })}
          options={toOptions(labelsFrom(INTERNAL_COLOUR_MESSAGES))}
          disabled={!canEdit}
        />
      </SettingsSection>

      <SettingsSection title={m.settings_placeholders_heading()} help={m.settings_placeholders_intro()}>
        <div>
          <SwitchField
            label={m.settings_placeholders_toggle()}
            checked={placeholdersEnabled}
            onChange={(next) => updateSetting({ placeholdersEnabled: next })}
            disabled={!canEdit}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title={m.settings_external_heading()}
        help={
          <>
            {/* Explainer copy (editable, shared with the Resources-tab External help modal — see
              lib/externalCopy.ts). Set per company; off by default. */}
            <span className="block">{externalExplainer()}</span>
            <span className="mt-2 block">{m.settings_external_intro()}</span>
          </>
        }
      >
        <div>
          <SwitchField
            label={m.settings_external_toggle()}
            checked={externalEnabled}
            onChange={(next) => updateSetting({ externalEnabled: next })}
            disabled={!canEdit}
          />
        </div>
      </SettingsSection>

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

      <SettingsSection title={m.settings_activity_create_heading()} help={m.settings_activity_create_intro()}>
        <div>
          <SwitchField
            label={m.settings_inline_activity_create_toggle()}
            checked={inlineActivityCreateEnabled}
            onChange={(next) => updateSetting({ inlineActivityCreateEnabled: next })}
            disabled={!canEdit}
          />
        </div>
      </SettingsSection>
    </>
  );
}
