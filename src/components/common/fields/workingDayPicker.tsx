import { useId } from "react";
import { FieldLegend, FieldSet } from "../../ui/field";
import { Label } from "../../ui/label";
import { m } from "@/i18n";
import type { Weekday } from "@capacitylens/shared/types/entities";
import { weekdayLabel } from "../../../lib/weekdays";
import { useMarkFormDirty } from "../formDirty";
import type { WorkingDayOption } from "./fieldTypes";

// Picker order: Monday-first, Sunday last. Labels resolve through Paraglide at render so they
// localise and follow a locale switch without a reload. Kept separate from the model order so the
// order isn't re-stated per locale.
const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

function workingDayOptions(): Array<{ value: WorkingDayOption; label: string }> {
  return [
    { value: "full", label: m.form_resource_working_day_full() },
    { value: "half", label: m.form_resource_working_day_half() },
    { value: "off", label: m.form_resource_working_day_off() },
  ];
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
  const options = workingDayOptions();
  const optionFor = (day: Weekday): WorkingDayOption =>
    !workingDays.includes(day) ? "off" : halfDays.includes(day) ? "half" : "full";
  const choose = (day: Weekday, option: WorkingDayOption) => {
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
    markDirty();
    onChange(nextWorkingDays, nextHalfDays);
  };

  return (
    <FieldSet
      className="min-w-0"
      aria-invalid={invalid || undefined}
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
            {WEEKDAY_ORDER.map((day) => {
              const dayLabel = weekdayLabel(day);
              const rowHeadingId = `${groupId}-${day}-heading`;
              return (
                <tr key={day} className="border-b last:border-b-0">
                  <th
                    id={rowHeadingId}
                    scope="row"
                    className="min-w-24 whitespace-nowrap px-3 py-2 text-left font-medium"
                  >
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
                            checked={optionFor(day) === option.value}
                            aria-labelledby={`${rowHeadingId} ${groupId}-${option.value}-heading`}
                            data-form-dirty-managed
                            className="size-4 cursor-pointer"
                            onChange={() => choose(day, option.value)}
                          />
                        </Label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </FieldSet>
  );
}
