import { m } from "@/i18n";
import type { orderedWeekdays } from "@capacitylens/shared/lib/accountWorkingDays";
import { resolveWeekdayLabel, resolveWeekdayShortLabel } from "../../lib/weekdays";
import { listAccountWorkingDays } from "../../store/selectors";
import type { StoreState } from "../../store/useStore";
import { Checkbox } from "../ui/checkbox";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "../ui/field";
import { SettingsSection } from "./SettingsSection";

type WorkingDays = ReturnType<typeof listAccountWorkingDays>;
type UpdateSetting = (patch: Parameters<StoreState["updateAccount"]>[1]) => void;

function WorkingDayCheckbox({
  canEdit,
  day,
  workingDays,
  workingDaysMinimumId,
  updateSetting,
}: {
  canEdit: boolean;
  day: WorkingDays[number];
  workingDays: WorkingDays;
  workingDaysMinimumId: string;
  updateSetting: UpdateSetting;
}) {
  const id = `account-working-day-${day}`;
  const checked = workingDays.includes(day);
  // Live-disable rather than submit-time validation: this table saves per toggle, so a refused
  // click must be impossible rather than rejected after it appears to save.
  const isOnlyWorkingDay = checked && workingDays.length === 1;

  return (
    <td className="px-1 text-center">
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
          {resolveWeekdayLabel(day)}
        </FieldLabel>
      </Field>
    </td>
  );
}

export function SettingsWorkingDaysSection({
  canEdit,
  workingDayOrder,
  workingDays,
  workingDaysMinimumId,
  updateSetting,
}: {
  canEdit: boolean;
  workingDayOrder: ReturnType<typeof orderedWeekdays>;
  workingDays: WorkingDays;
  workingDaysMinimumId: string;
  updateSetting: UpdateSetting;
}) {
  return (
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
                  {resolveWeekdayShortLabel(day)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {workingDayOrder.map((day) => (
                <WorkingDayCheckbox
                  key={day}
                  canEdit={canEdit}
                  day={day}
                  workingDays={workingDays}
                  workingDaysMinimumId={workingDaysMinimumId}
                  updateSetting={updateSetting}
                />
              ))}
            </tr>
          </tbody>
        </table>
        {workingDays.length === 1 && (
          <FieldDescription id={workingDaysMinimumId}>{m.settings_working_days_min_one()}</FieldDescription>
        )}
      </FieldSet>
    </SettingsSection>
  );
}
