import { useId } from "react";
import { FieldLegend, FieldSet } from "../../ui/field";
import { Label } from "../../ui/label";
import { m } from "@/i18n";
import type { Weekday } from "@capacitylens/shared/types/entities";
import { resolveWeekdayLabel } from "../../../lib/weekdays";
import { useMarkFormDirty } from "../formDirty";
import type { WorkingDayOption } from "./fieldTypes";

// Picker order: Monday-first, Sunday last. Labels resolve through Paraglide at render so they
// localise and follow a locale switch without a reload. Kept separate from the model order so the
// order isn't re-stated per locale.
const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

function buildWorkingDayOptions(): Array<{ value: WorkingDayOption; label: string }> {
  return [
    { value: "full", label: m.form_resource_working_day_full() },
    { value: "half", label: m.form_resource_working_day_half() },
    { value: "off", label: m.form_resource_working_day_off() },
  ];
}

function resolveWorkingDayOption(day: Weekday, workingDays: Weekday[], halfDays: Weekday[]): WorkingDayOption {
  if (!workingDays.includes(day)) return "off";
  return halfDays.includes(day) ? "half" : "full";
}

function applyWorkingDayOption({
  day,
  option,
  workingDays,
  halfDays,
}: {
  day: Weekday;
  option: WorkingDayOption;
  workingDays: Weekday[];
  halfDays: Weekday[];
}): { workingDays: Weekday[]; halfDays: Weekday[] } {
  const nextWorkingDays =
    option === "off"
      ? workingDays.filter((candidate) => candidate !== day)
      : [...new Set([...workingDays, day])].sort((a, b) => a - b);
  const nextHalfDays =
    option === "half"
      ? [...new Set([...halfDays, day])]
          .filter((candidate) => nextWorkingDays.includes(candidate))
          .sort((a, b) => a - b)
      : halfDays.filter((candidate) => candidate !== day);
  return { workingDays: nextWorkingDays, halfDays: nextHalfDays };
}

interface WorkingDayRowsProps {
  groupId: string;
  workingDays: Weekday[];
  halfDays: Weekday[];
  onChoose: (day: Weekday, option: WorkingDayOption) => void;
  options: ReturnType<typeof buildWorkingDayOptions>;
}

function chooseWorkingDay({
  day,
  option,
  workingDays,
  halfDays,
  markDirty,
  onChange,
}: {
  day: Weekday;
  option: WorkingDayOption;
  workingDays: Weekday[];
  halfDays: Weekday[];
  markDirty: () => void;
  onChange: (workingDays: Weekday[], halfDays: Weekday[]) => void;
}) {
  const next = applyWorkingDayOption({ day, option, workingDays, halfDays });
  markDirty();
  onChange(next.workingDays, next.halfDays);
}

function WorkingDayRows({ groupId, workingDays, halfDays, onChoose, options }: WorkingDayRowsProps) {
  return WEEKDAY_ORDER.map((day) => {
    const dayLabel = resolveWeekdayLabel(day);
    const rowHeadingId = `${groupId}-${day}-heading`;
    return (
      <tr key={day} className="border-b last:border-b-0">
        <th id={rowHeadingId} scope="row" className="min-w-24 whitespace-nowrap px-3 py-2 text-left font-medium">
          {dayLabel}
        </th>
        {options.map((option) => {
          const radioId = `${groupId}-${day}-${option.value}`;
          return (
            <td key={option.value} className="px-3 py-1 text-center">
              <Label htmlFor={radioId} className="flex min-h-8 cursor-pointer justify-center">
                <input
                  id={radioId}
                  type="radio"
                  name={`${groupId}-${day}`}
                  value={option.value}
                  checked={resolveWorkingDayOption(day, workingDays, halfDays) === option.value}
                  aria-labelledby={`${rowHeadingId} ${groupId}-${option.value}-heading`}
                  data-form-dirty-managed
                  className="size-4 cursor-pointer"
                  onChange={() => onChoose(day, option.value)}
                />
              </Label>
            </td>
          );
        })}
      </tr>
    );
  });
}

export function WorkingDayPicker({
  label,
  workingDays,
  halfDays,
  onChange,
  invalid,
  describedById,
}: {
  label: string;
  workingDays: Weekday[];
  halfDays: Weekday[];
  onChange: (workingDays: Weekday[], halfDays: Weekday[]) => void;
  // Mirror the sibling fields (TextField/SelectField/NumberField): mark the GROUP errored so the
  // required-error (no day selected) re-announces when a SR navigates to the fieldset (WCAG 3.3.1).
  invalid?: boolean;
  describedById?: string;
}) {
  const markDirty = useMarkFormDirty();
  const groupId = useId();
  const options = buildWorkingDayOptions();

  return (
    <FieldSet
      className="min-w-0"
      aria-invalid={invalid === true ? true : undefined}
      aria-describedby={invalid ? describedById : undefined}
    >
      <FieldLegend variant="label">{label}</FieldLegend>
      <div className="min-w-0 w-full max-w-full overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th scope="col" className="sr-only">
                {m.form_resource_working_day_weekday()}
              </th>
              {options.map((option) => (
                <th
                  key={option.value}
                  id={`${groupId}-${option.value}-heading`}
                  scope="col"
                  className="min-w-24 whitespace-nowrap px-3 py-2 text-center text-xs font-medium text-muted-foreground"
                >
                  {option.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <WorkingDayRows
              groupId={groupId}
              workingDays={workingDays}
              halfDays={halfDays}
              onChoose={(day, option) => chooseWorkingDay({ day, option, workingDays, halfDays, markDirty, onChange })}
              options={options}
            />
          </tbody>
        </table>
      </div>
    </FieldSet>
  );
}
