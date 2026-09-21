import { MAX_NAME_INPUT_CODE_UNITS, MAX_NOTE_INPUT_CODE_UNITS } from "@capacitylens/shared/lib/strings";
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
import { buildAllocationStatusOptions } from "../../lib/metadata";
import { formatShortDateEndpoint } from "../../lib/dateDisplay";
import { AllocationControlColumn, AllocationSpanRow, DateRangeFields } from "./AllocationModalFieldLayout";
import type { AllocationModalState } from "./useAllocationModalState";

const roundDisplayHours = (numericValue: number) => Math.round(numericValue * 100) / 100;

const buildRepeatOptions = (): Option[] => [
  { value: "none", label: m.form_allocation_repeat_none() },
  { value: "weekly", label: m.form_allocation_repeat_weekly() },
  { value: "every-two-weeks", label: m.form_allocation_repeat_every_two_weeks() },
  { value: "every-three-weeks", label: m.form_allocation_repeat_every_three_weeks() },
  { value: "every-four-weeks", label: m.form_allocation_repeat_every_four_weeks() },
  { value: "monthly", label: m.form_allocation_repeat_monthly() },
];

const buildHoursPerDayOptions = (): Option[] => [
  { value: "1", label: m.form_allocation_hours_per_day_one_hour() },
  { value: "2", label: m.form_allocation_hours_per_day_quarter_day() },
  { value: "4", label: m.form_allocation_hours_per_day_half_day() },
  { value: "8", label: m.form_allocation_hours_per_day_full_day() },
];

type ScheduleProps = AllocationModalState["scheduleFields"];
type TaskProps = Pick<ScheduleProps, "task" | "setTask" | "showTaskFieldInSchedule" | "errorField" | "errorId">;

function TaskField(props: TaskProps) {
  if (!props.showTaskFieldInSchedule) return null;
  return (
    <TextField
      label={m.form_allocation_task_label()}
      value={props.task}
      onChange={props.setTask}
      maxLength={MAX_NAME_INPUT_CODE_UNITS}
      invalid={props.errorField === "task"}
      describedById={props.errorId}
      layout="label-control"
    />
  );
}

type TypedSpanProps = Pick<
  ScheduleProps,
  | "isExternal"
  | "startDate"
  | "setStartDate"
  | "endDate"
  | "setEndDate"
  | "hoursPerDay"
  | "setHoursPerDay"
  | "errorField"
  | "errorId"
>;

function TypedSpanFields(props: TypedSpanProps) {
  return (
    <AllocationSpanRow columns={props.isExternal ? 2 : 3}>
      <DateRangeFields
        startDate={props.startDate}
        endDate={props.endDate}
        onStartChange={props.setStartDate}
        onEndChange={props.setEndDate}
        invalid={props.errorField === "dates"}
        describedById={props.errorId}
      />
      {!props.isExternal && (
        <SelectField
          label={m.form_allocation_hours_per_day_label()}
          value={String(props.hoursPerDay)}
          onChange={(value) => props.setHoursPerDay(Number(value))}
          options={buildHoursPerDayOptions()}
          required
          invalid={props.errorField === "hours"}
          describedById={props.errorId}
        />
      )}
    </AllocationSpanRow>
  );
}

type CountedSpanProps = Pick<
  ScheduleProps,
  | "isDays"
  | "startDate"
  | "setStartDate"
  | "endDateHint"
  | "effHoursPerDay"
  | "daysOfWork"
  | "setDaysOfWork"
  | "daysOver"
  | "setDaysOver"
  | "maximumDaysOver"
  | "daysOverDisabled"
  | "errorField"
  | "errorId"
>;

function countedSpanHint(props: CountedSpanProps) {
  if (!props.startDate || !props.endDateHint) return undefined;
  const message = props.isDays
    ? m.form_allocation_ends_hint_hours({
        date: props.endDateHint,
        hours: roundDisplayHours(props.effHoursPerDay),
      })
    : m.form_allocation_ends_hint({ date: props.endDateHint });
  return <p className="text-xs text-muted-foreground">{message}</p>;
}

function CountedSpanFields(props: CountedSpanProps) {
  return (
    <AllocationSpanRow columns={props.isDays ? 3 : 2} hint={countedSpanHint(props)}>
      <DateField
        label={m.form_allocation_start_date_label()}
        value={props.startDate}
        onChange={props.setStartDate}
        required
        invalid={props.errorField === "dates"}
        describedById={props.errorId}
      />
      {props.isDays && (
        <NumberField
          label={m.form_allocation_days_of_work_label()}
          value={props.daysOfWork}
          onChange={props.setDaysOfWork}
          min={0}
          step={0.5}
          required
          invalid={props.errorField === "daysOfWork"}
          describedById={props.errorId}
        />
      )}
      <NumberField
        label={m.form_allocation_days_over_label()}
        value={props.daysOver}
        onChange={props.setDaysOver}
        min={1}
        max={props.maximumDaysOver}
        step={1}
        disabled={props.daysOverDisabled}
        invalid={props.errorField === "daysOver"}
        describedById={props.errorId}
      />
    </AllocationSpanRow>
  );
}

type RepeatProps = Pick<
  ScheduleProps,
  | "repeat"
  | "onRepeatChange"
  | "repeatUntil"
  | "onRepeatUntilChange"
  | "repeatUntilMinimum"
  | "repeatUntilMaximum"
  | "repeatProjection"
  | "repeatLastStart"
  | "errorField"
  | "errorId"
>;

function RepeatFields(props: RepeatProps) {
  return (
    <>
      <SelectField
        label={m.form_allocation_repeat_label()}
        value={props.repeat}
        onChange={props.onRepeatChange}
        options={buildRepeatOptions()}
        layout="label-control"
      />
      {props.repeat !== "none" && (
        <DateField
          label={m.form_allocation_repeat_until_label()}
          value={props.repeatUntil}
          onChange={props.onRepeatUntilChange}
          required
          invalid={props.errorField === "repeatUntil"}
          describedById={props.errorId}
          min={props.repeatUntilMinimum}
          {...(props.repeatUntilMaximum ? { max: props.repeatUntilMaximum } : {})}
          layout="label-control"
        />
      )}
      {props.repeatProjection && props.repeatLastStart && <RepeatPreview {...props} />}
    </>
  );
}

function RepeatPreview(props: RepeatProps) {
  if (!props.repeatProjection || !props.repeatLastStart) return null;
  // Both dates are read against the FIRST occurrence — the start the reader has just set, a few
  // fields above — rather than against each other. A repeat running into a new year then dates its
  // cutoff ("through Mon 11th Jan 2100") instead of naming a bare January day that reads as one
  // eleven months BEFORE the booking it repeats.
  const anchor = props.repeatProjection.startDates[0] ?? props.repeatLastStart;
  return (
    <AllocationControlColumn>
      <p className="text-xs text-muted-foreground">
        {m.form_allocation_repeat_preview({
          count: props.repeatProjection.startDates.length,
          repeatUntil: formatShortDateEndpoint(props.repeatUntil, anchor),
          lastStart: formatShortDateEndpoint(props.repeatLastStart, anchor),
        })}
      </p>
    </AllocationControlColumn>
  );
}

type DetailProps = Pick<
  ScheduleProps,
  | "isExternal"
  | "status"
  | "setStatus"
  | "note"
  | "setNote"
  | "setNoteEdited"
  | "ignoreWeekends"
  | "setIgnoreWeekends"
  | "advisory"
  | "error"
  | "errorField"
  | "errorId"
>;

function DetailFields(props: DetailProps) {
  const setNote = (value: string) => {
    props.setNoteEdited(true);
    props.setNote(value);
  };
  return (
    <>
      <SegmentedField
        label={m.form_allocation_status_label()}
        value={props.status}
        onChange={props.setStatus}
        options={buildAllocationStatusOptions()}
        geometry="connected"
        fullWidth
        layout="label-control"
      />
      <TextField
        label={m.form_allocation_note_label()}
        value={props.note}
        onChange={setNote}
        maxLength={MAX_NOTE_INPUT_CODE_UNITS}
        invalid={props.errorField === "note"}
        describedById={props.errorId}
        layout="label-control"
      />
      {!props.isExternal && (
        <CheckboxField
          label={m.form_allocation_ignore_working_days()}
          checked={props.ignoreWeekends}
          onChange={props.setIgnoreWeekends}
          layout="label-control"
        />
      )}
      {props.advisory && (
        <Alert variant="warn" role="status">
          <AlertDescription>{props.advisory}</AlertDescription>
        </Alert>
      )}
      <FieldError id={props.errorId} tabIndex={props.error && props.errorField === null ? -1 : undefined}>
        {props.error}
      </FieldError>
      <RequiredLegend />
    </>
  );
}

export function AllocationScheduleFields(props: ScheduleProps) {
  return (
    <>
      <TaskField {...props} />
      {props.usesTypedDateRange ? <TypedSpanFields {...props} /> : <CountedSpanFields {...props} />}
      {props.create && <RepeatFields {...props} />}
      <DetailFields {...props} />
    </>
  );
}
