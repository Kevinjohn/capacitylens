import type { ISODate } from "@capacitylens/shared/types/entities";
import { MAX_NOTE_INPUT_CODE_UNITS } from "@capacitylens/shared/lib/strings";
import { m } from "@/i18n";
import {
  CheckboxField,
  DateField,
  NumberField,
  RequiredLegend,
  SegmentedField,
  SelectField,
  TextField,
  type Option,
} from "../common/ui";
import { Alert, AlertDescription } from "../ui/alert";
import { FieldError } from "../ui/field";
import { allocationStatusOptions } from "../../lib/metadata";
import { formatShortDate } from "../../lib/dateDisplay";
import { AllocationControlColumn, AllocationSpanRow, DateRangeFields } from "./AllocationModalFieldLayout";
import type { AllocationModalState } from "./useAllocationModalState";

/** 2-dp rounding for the human-readable "…h/day" hint only — never fed back into a value. */
const round2 = (n: number) => Math.round(n * 100) / 100;

const repeatOptions = (): Option[] => [
  { value: "none", label: m.form_allocation_repeat_none() },
  { value: "weekly", label: m.form_allocation_repeat_weekly() },
  { value: "every-two-weeks", label: m.form_allocation_repeat_every_two_weeks() },
  { value: "every-three-weeks", label: m.form_allocation_repeat_every_three_weeks() },
  { value: "every-four-weeks", label: m.form_allocation_repeat_every_four_weeks() },
  { value: "monthly", label: m.form_allocation_repeat_monthly() },
];

const hoursPerDayOptions = (): Option[] => [
  { value: "1", label: m.form_allocation_hours_per_day_one_hour() },
  { value: "2", label: m.form_allocation_hours_per_day_quarter_day() },
  { value: "4", label: m.form_allocation_hours_per_day_half_day() },
  { value: "8", label: m.form_allocation_hours_per_day_full_day() },
];

type AllocationScheduleFieldsProps = AllocationModalState["scheduleFields"];

export function AllocationScheduleFields({
  usesTypedDateRange,
  isExternal,
  isDays,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  hoursPerDay,
  setHoursPerDay,
  endDateHint,
  effHoursPerDay,
  daysOfWork,
  setDaysOfWork,
  daysOver,
  setDaysOver,
  maximumDaysOver,
  daysOverDisabled,
  ignoreWeekends,
  setIgnoreWeekends,
  create,
  repeat,
  onRepeatChange,
  repeatUntil,
  onRepeatUntilChange,
  repeatUntilMinimum,
  repeatUntilMaximum,
  repeatProjection,
  repeatLastStart,
  status,
  setStatus,
  note,
  setNote,
  setNoteEdited,
  advisory,
  error,
  errorField,
  errorId,
}: AllocationScheduleFieldsProps) {
  return (
    <>
      {usesTypedDateRange ? (
        <AllocationSpanRow columns={isExternal ? 2 : 3}>
          <DateRangeFields
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
            invalid={errorField === "dates"}
            describedById={errorId}
          />
          {/* Externals carry no load (hoursPerDay 0), so only the hourly arm asks for one. */}
          {!isExternal && (
            <SelectField
              label={m.form_allocation_hours_per_day_label()}
              value={String(hoursPerDay)}
              onChange={(value) => setHoursPerDay(Number(value))}
              options={hoursPerDayOptions()}
              required
              invalid={errorField === "hours"}
              describedById={errorId}
            />
          )}
        </AllocationSpanRow>
      ) : (
        // Blocks and days are the same span control — a start plus a "days over" count — differing
        // only by the work-volume field days adds, and by whether the derived-end hint also states
        // the rescaled load.
        <AllocationSpanRow
          columns={isDays ? 3 : 2}
          hint={
            startDate && endDateHint ? (
              <p className="text-xs text-muted-foreground">
                {isDays
                  ? m.form_allocation_ends_hint_hours({ date: endDateHint, hours: round2(effHoursPerDay) })
                  : m.form_allocation_ends_hint({ date: endDateHint })}
              </p>
            ) : undefined
          }
        >
          <DateField
            label={m.form_allocation_start_date_label()}
            value={startDate}
            onChange={setStartDate}
            required
            invalid={errorField === "dates"}
            describedById={errorId}
          />
          {isDays && (
            <NumberField
              label={m.form_allocation_days_of_work_label()}
              value={daysOfWork}
              onChange={setDaysOfWork}
              min={0}
              step={0.5}
              required
              invalid={errorField === "daysOfWork"}
              describedById={errorId}
            />
          )}
          <NumberField
            label={m.form_allocation_days_over_label()}
            value={daysOver}
            onChange={setDaysOver}
            min={1}
            max={maximumDaysOver}
            step={1}
            // No effective working days ⇒ a working span is undefined; the count stays at its
            // neutral seed so a permitted edit cannot silently rescale the stored volume.
            disabled={daysOverDisabled}
            invalid={errorField === "daysOver"}
            describedById={errorId}
          />
        </AllocationSpanRow>
      )}
      {create && (
        <>
          <SelectField
            label={m.form_allocation_repeat_label()}
            value={repeat}
            onChange={onRepeatChange}
            options={repeatOptions()}
            layout="label-control"
          />
          {repeat !== "none" && (
            <DateField
              label={m.form_allocation_repeat_until_label()}
              value={repeatUntil}
              onChange={onRepeatUntilChange}
              required
              invalid={errorField === "repeatUntil"}
              describedById={errorId}
              min={repeatUntilMinimum}
              max={repeatUntilMaximum}
              layout="label-control"
            />
          )}
          {repeatProjection && repeatLastStart && (
            <AllocationControlColumn>
              <p className="text-xs text-muted-foreground">
                {m.form_allocation_repeat_preview({
                  count: repeatProjection.startDates.length,
                  repeatUntil: formatShortDate(repeatUntil as ISODate),
                  lastStart: formatShortDate(repeatLastStart),
                })}
              </p>
            </AllocationControlColumn>
          )}
        </>
      )}
      <SegmentedField
        label={m.form_allocation_status_label()}
        value={status}
        onChange={setStatus}
        options={allocationStatusOptions()}
        geometry="connected"
        fullWidth
        layout="label-control"
      />
      <TextField
        label={m.form_allocation_note_label()}
        value={note}
        onChange={(value) => {
          setNoteEdited(true);
          setNote(value);
        }}
        maxLength={MAX_NOTE_INPUT_CODE_UNITS}
        invalid={errorField === "note"}
        describedById={errorId}
        layout="label-control"
      />

      {/* Externals have no working pattern — their booking is already a literal start/end span, so
          this checkbox is meaningless and hidden (they store ignoreWeekends: true). */}
      {!isExternal && (
        <CheckboxField
          label={m.form_allocation_ignore_working_days()}
          checked={ignoreWeekends}
          onChange={setIgnoreWeekends}
          layout="label-control"
        />
      )}

      {advisory && (
        <Alert variant="warn" role="status">
          <AlertDescription>{advisory}</AlertDescription>
        </Alert>
      )}
      <FieldError id={errorId} tabIndex={error && errorField === null ? -1 : undefined}>
        {error}
      </FieldError>
      <RequiredLegend />
    </>
  );
}
