import { format } from "date-fns";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import { parseDate } from "@capacitylens/shared/lib/dateMath";
import type { ISODate } from "@capacitylens/shared/types/entities";
import { readActiveDateLocale, m } from "@/i18n";
import { formatScheduleDate } from "@/lib/dateDisplay";
import type { TimeOffRepeatChoice } from "./useTimeOffRepeat";
import type { buildRepeatedTimeOffDrafts } from "../../lib/repeatingTimeOff";
import { DateField, SelectField, type Option } from "../common/ui";

type RepeatProjection = ReturnType<typeof buildRepeatedTimeOffDrafts>;

interface TimeOffRepeatFieldsProps {
  startDate: ISODate | "";
  repeat: TimeOffRepeatChoice;
  repeatUntil: ISODate | "";
  repeatUntilMaximum: ISODate | undefined;
  projection: RepeatProjection | null;
  errorField: string | null;
  errorId: string;
  onRepeatChange: (value: string) => void;
  onRepeatUntilChange: (value: string) => void;
}

function buildRepeatOptions(startDate: ISODate | ""): Option[] {
  const hasDate = isValidISODate(startDate);
  const day = hasDate ? Number(startDate.slice(8, 10)) : undefined;
  const weekday = hasDate ? format(parseDate(startDate), "EEEE", { locale: readActiveDateLocale() }) : undefined;
  return [
    { value: "none", label: m.form_timeoff_repeat_none() },
    { value: "weekly", label: m.form_timeoff_repeat_weekly() },
    { value: "every-two-weeks", label: m.form_timeoff_repeat_every_two_weeks() },
    { value: "every-three-weeks", label: m.form_timeoff_repeat_every_three_weeks() },
    { value: "every-four-weeks", label: m.form_timeoff_repeat_every_four_weeks() },
    {
      value: "monthly-date",
      label: day ? m.form_timeoff_repeat_monthly_date({ day }) : m.form_timeoff_repeat_monthly_date_fallback(),
    },
    {
      value: "monthly-last-weekday",
      label: weekday
        ? m.form_timeoff_repeat_monthly_last_weekday({ weekday })
        : m.form_timeoff_repeat_monthly_last_weekday_fallback(),
    },
  ];
}

function TimeOffRepeatPreview({ projection }: { projection: RepeatProjection }) {
  const finalDraft = projection.drafts.at(-1);
  if (!finalDraft) return null;
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground" data-testid="timeoff-repeat-preview">
      <p>
        {m.form_timeoff_repeat_preview({
          count: projection.drafts.length,
          start: formatScheduleDate(finalDraft.startDate),
          end: formatScheduleDate(finalDraft.endDate),
        })}
      </p>
      <details data-testid="timeoff-repeat-ranges">
        <summary className="cursor-pointer">{m.form_timeoff_repeat_show_dates()}</summary>
        <ol className="mt-1 list-decimal pl-5">
          {projection.drafts.map((draft) => (
            <li key={draft.startDate}>
              {formatScheduleDate(draft.startDate)} – {formatScheduleDate(draft.endDate)}
            </li>
          ))}
        </ol>
      </details>
      <p>{m.form_timeoff_repeat_independent_hint()}</p>
    </div>
  );
}

export function TimeOffRepeatFields(props: TimeOffRepeatFieldsProps) {
  return (
    <>
      <SelectField
        label={m.form_timeoff_repeat_label()}
        value={props.repeat}
        onChange={props.onRepeatChange}
        options={buildRepeatOptions(props.startDate)}
        invalid={props.errorField === "repeat"}
        describedById={props.errorId}
        testId="timeoff-repeat"
        layout="label-control"
      />
      {props.repeat !== "none" && (
        <>
          <DateField
            label={m.form_timeoff_repeat_until_label()}
            value={props.repeatUntil}
            onChange={props.onRepeatUntilChange}
            required
            invalid={props.errorField === "repeatUntil"}
            describedById={props.errorId}
            {...(props.startDate ? { min: props.startDate } : {})}
            {...(props.repeatUntilMaximum ? { max: props.repeatUntilMaximum } : {})}
            testId="timeoff-repeat-until"
            layout="label-control"
          />
          <p className="text-xs text-muted-foreground">{m.form_timeoff_repeat_cutoff_hint()}</p>
        </>
      )}
      {props.projection && <TimeOffRepeatPreview projection={props.projection} />}
    </>
  );
}
