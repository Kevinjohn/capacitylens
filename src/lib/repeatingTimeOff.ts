import { addDaysISO, daysInclusive } from "@capacitylens/shared/lib/dateMath";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import {
  generateRepeatingStartDates,
  TIME_OFF_REPEAT_POLICY,
  type RepeatPattern,
} from "@capacitylens/shared/lib/repeatingDates";
import type { ISODate, TimeOff } from "@capacitylens/shared/types/entities";
import type { Draft } from "../store/useStore";

/** A create-only cadence; persisted time-off entries remain independent dated records. */
export type TimeOffRepeatSelection =
  "weekly" | "every-two-weeks" | "every-three-weeks" | "every-four-weeks" | "monthly-date" | "monthly-last-weekday";

const TIME_OFF_REPEAT_PATTERNS: Record<TimeOffRepeatSelection, RepeatPattern> = {
  weekly: { kind: "weeks", interval: 1 },
  "every-two-weeks": { kind: "weeks", interval: 2 },
  "every-three-weeks": { kind: "weeks", interval: 3 },
  "every-four-weeks": { kind: "weeks", interval: 4 },
  "monthly-date": { kind: "monthly-date" },
  "monthly-last-weekday": { kind: "monthly-last-weekday" },
};

export function resolveTimeOffRepeatPattern(selection: TimeOffRepeatSelection): RepeatPattern {
  return TIME_OFF_REPEAT_PATTERNS[selection];
}

/** Generate the exact independent drafts shared by the form preview and its one atomic save. */
export function buildRepeatedTimeOffDrafts(
  baseDraft: Draft<TimeOff>,
  repeatUntil: ISODate,
  selection: TimeOffRepeatSelection,
): { repeatUntil: ISODate; drafts: Draft<TimeOff>[] } {
  if (!isValidISODate(baseDraft.startDate) || !isValidISODate(baseDraft.endDate)) {
    throw new RangeError("Time off requires valid ISO dates.");
  }
  const duration = daysInclusive(baseDraft.startDate, baseDraft.endDate);
  if (!Number.isSafeInteger(duration) || duration < 1) {
    throw new RangeError("Repeat projection requires a valid inclusive date range.");
  }
  const generated = generateRepeatingStartDates(
    baseDraft.startDate,
    repeatUntil,
    resolveTimeOffRepeatPattern(selection),
    TIME_OFF_REPEAT_POLICY,
  );
  const drafts = generated.startDates.map((startDate, index) => {
    if (index === 0) return baseDraft;
    return { ...baseDraft, startDate, endDate: addDaysISO(startDate, duration - 1) };
  });
  return { repeatUntil: generated.repeatUntil, drafts };
}
