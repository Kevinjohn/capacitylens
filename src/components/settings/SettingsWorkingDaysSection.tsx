import { m } from "@/i18n";
import type { orderedWeekdays } from "@capacitylens/shared/lib/accountWorkingDays";
import { resolveWeekdayLabel, resolveWeekdayShortLabel } from "@/lib/weekdays";
import type { listAccountWorkingDays } from "@/store/selectors";
import type { StoreState } from "@/store/useStore";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
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
  // Live-disable rather than submit-time validation: each toggle saves immediately, so a refused
  // change must be impossible rather than rejected after it appears to save.
  const isOnlyWorkingDay = checked && workingDays.length === 1;
  const disabled = !canEdit || isOnlyWorkingDay;

  return (
    <Field orientation="horizontal" data-disabled={disabled || undefined} className="justify-center gap-0">
      <FieldLabel
        htmlFor={id}
        data-disabled={disabled || undefined}
        className="min-h-12 min-w-12 cursor-pointer flex-col items-center justify-center gap-1 py-1 text-xs data-[disabled=true]:cursor-not-allowed"
      >
        <span>{resolveWeekdayShortLabel(day)}</span>
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          aria-label={resolveWeekdayLabel(day)}
          aria-describedby={isOnlyWorkingDay ? workingDaysMinimumId : undefined}
          onCheckedChange={() =>
            updateSetting({
              workingDays: checked
                ? workingDays.filter((candidate) => candidate !== day)
                : [...workingDays, day].sort((a, b) => a - b),
            })
          }
        />
      </FieldLabel>
    </Field>
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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(3rem,1fr))] gap-1">
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
        </div>
        {workingDays.length === 1 && (
          <FieldDescription id={workingDaysMinimumId}>{m.settings_working_days_min_one()}</FieldDescription>
        )}
      </FieldSet>
    </SettingsSection>
  );
}
