import type { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { daysInclusive, todayISO } from "@capacitylens/shared/lib/dateMath";
import { effectiveWorkingWeek, lacksEffectiveWorkingDays } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import { defaultRepeatUntilDate, maximumRepeatUntilDate } from "@capacitylens/shared/lib/repeatingDates";
import { daysOfWorkFor, MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";
import type { AllocationStatus, ISODate, Resource, SchedulingMode } from "@capacitylens/shared/types/entities";
import { carriesHourlyLoad, FULL_DAY_HOURS } from "@capacitylens/shared/types/entities";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RepeatSelection } from "../../lib/repeatingAllocations";

import type { AllocationModalSeed } from "./allocationModalSeed";
import { effectiveAllocationValues, roundDays, usesWorkingSpanFor } from "./allocationModalSelection";
interface ScheduleInput {
  selectedResource: Resource | undefined;
  mode: SchedulingMode;
  accountWorkingDays: ReturnType<typeof normalizeAccountWorkingDays>;
  calendarTimeZone: string;
  seed: AllocationModalSeed;
}
export function useAllocationScheduleState({
  selectedResource,
  mode,
  accountWorkingDays,
  calendarTimeZone,
  seed,
}: ScheduleInput) {
  const { editing, create, initialStart, initialScheduledHours, initialDaysOver, initialCapacityHours } = seed;
  const isDays = mode === "days";
  const isBlocks = !carriesHourlyLoad(mode);
  const [startDate, setStartDate] = useState<ISODate>(initialStart);
  const [endDate, setEndDate] = useState<ISODate>(editing?.endDate ?? create?.endDate ?? todayISO(calendarTimeZone));
  const [hoursPerDay, setHoursPerDay] = useState(editing?.hoursPerDay ?? (initialScheduledHours || FULL_DAY_HOURS));
  const [status, setStatus] = useState<AllocationStatus>(editing?.status ?? "confirmed");
  const [note, setNote] = useState(editing?.note ?? "");
  const [noteEdited, setNoteEdited] = useState(false);
  const [ignoreWeekends, setIgnoreWeekends] = useState(editing?.ignoreWeekends ?? false);
  const [repeat, setRepeat] = useState<RepeatSelection>("none");
  const [repeatUntil, setRepeatUntil] = useState("");
  const repeatUntilIsSuggested = useRef(false);
  // NumberField can expose a transient 0 while the user clears the number input. Submission below
  // validates daysOver explicitly; the defensive 1 used for the live preview is never persisted.
  const [daysOver, setDaysOver] = useState(initialDaysOver);
  const [daysOfWork, setDaysOfWork] = useState(
    editing
      ? roundDays(daysOfWorkFor(editing.hoursPerDay, initialDaysOver, FULL_DAY_HOURS))
      : roundDays(initialCapacityHours > 0 ? initialCapacityHours / FULL_DAY_HOURS : initialDaysOver),
  );
  const selectedEffectiveWeek = useMemo(
    () => (selectedResource ? effectiveWorkingWeek(selectedResource, accountWorkingDays) : null),
    [accountWorkingDays, selectedResource],
  );
  const effectiveValues = useMemo(
    () =>
      effectiveAllocationValues({
        resource: selectedResource,
        effectiveWeek: selectedEffectiveWeek,
        mode,
        startDate,
        endDate,
        hoursPerDay,
        daysOver,
        daysOfWork,
        ignoreWeekends,
      }),
    [
      daysOfWork,
      daysOver,
      endDate,
      hoursPerDay,
      ignoreWeekends,
      mode,
      selectedEffectiveWeek,
      selectedResource,
      startDate,
    ],
  );
  const {
    external: isExternal,
    validDaysOver,
    spanFitsDateDomain,
    maximumDaysOver,
    spanLimitedByDateDomain,
    endDate: effEndDate,
    hoursPerDay: effHoursPerDay,
  } = effectiveValues;
  // External and hourly allocations both collect a raw Start/End pair; blocks and days derive their
  // end from a (start, days-over) span instead. ONE predicate drives both the fields that render and
  // the range validation on save, so the form can never validate a pair it did not show.
  const usesTypedDateRange = isExternal || (!isBlocks && !isDays);
  // Effective range/hours fed to the capacity check and the store. In days mode the
  // end date and hours/day are DERIVED from (start, days of work, days over) against
  // the assignee/company effective week; in hourly mode the typed fields are used as-is.
  // Effective end date + hours from the assignee kind + the account's scheduling mode:
  //   external → a plain typed start/end span, no load (hoursPerDay 0);
  //   blocks   → a (start, days-over) span, no load (0);
  //   days     → a (start, days-over) span, hours rescaled to fit the work volume;
  //   hourly   → the typed end + hours as-is.
  // Raw End-date modes need the same finite span boundary as Days/Blocks. Use the O(1) calendar
  // difference here: deriving the range with eachDayISO just to validate it would itself recreate
  // the multi-million-day render freeze this guard prevents.
  const typedDateSpanDays = startDate && endDate ? daysInclusive(startDate, endDate) : 0;
  const typedDateSpanTooLong = typedDateSpanDays > MAX_SPAN_DAYS;
  const repeatToday = todayISO(calendarTimeZone);
  const repeatUntilMinimum = isValidISODate(startDate) && startDate > repeatToday ? startDate : repeatToday;
  const repeatUntilMaximum = isValidISODate(startDate) ? maximumRepeatUntilDate(startDate) : undefined;

  useEffect(() => {
    if (repeat !== "none" && repeatUntilIsSuggested.current && isValidISODate(startDate)) {
      setRepeatUntil(defaultRepeatUntilDate(startDate));
    }
  }, [repeat, startDate]);

  const onRepeatChange = (value: string) => {
    const next = value as RepeatSelection;
    if (repeat === "none" && next !== "none" && isValidISODate(startDate)) {
      repeatUntilIsSuggested.current = true;
      setRepeatUntil(defaultRepeatUntilDate(startDate));
    } else if (next === "none") {
      repeatUntilIsSuggested.current = false;
      setRepeatUntil("");
    }
    setRepeat(next);
  };

  const onRepeatUntilChange = (value: string) => {
    repeatUntilIsSuggested.current = false;
    setRepeatUntil(value);
  };

  const daysOverDisabled =
    usesWorkingSpanFor(selectedResource, mode) && lacksEffectiveWorkingDays(selectedEffectiveWeek, ignoreWeekends);

  return {
    selectedEffectiveWeek,
    effEndDate,
    validDaysOver,
    spanFitsDateDomain,
    spanLimitedByDateDomain,
    typedDateSpanTooLong,
    repeatToday,
    noteEdited,
    fields: {
      usesTypedDateRange,
      isExternal,
      isDays,
      startDate,
      setStartDate,
      endDate,
      setEndDate,
      hoursPerDay,
      setHoursPerDay,
      effHoursPerDay,
      daysOfWork,
      setDaysOfWork,
      daysOver,
      setDaysOver,
      maximumDaysOver,
      daysOverDisabled,
      ignoreWeekends,
      setIgnoreWeekends,
      repeat,
      onRepeatChange,
      repeatUntil,
      onRepeatUntilChange,
      repeatUntilMinimum,
      repeatUntilMaximum,
      status,
      setStatus,
      note,
      setNote,
      setNoteEdited,
    },
  };
}
