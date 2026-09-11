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

import type { AllocationModalSeed } from "./buildAllocationModalSeed";
import { buildEffectiveAllocationValues, roundDays, hasWorkingSpan } from "./allocationModalSelection";
interface ScheduleInput {
  selectedResource: Resource | undefined;
  mode: SchedulingMode;
  accountWorkingDays: ReturnType<typeof normalizeAccountWorkingDays>;
  calendarTimeZone: string;
  seed: AllocationModalSeed;
}

function useEffectiveSchedule(input: {
  selectedResource: Resource | undefined;
  accountWorkingDays: ReturnType<typeof normalizeAccountWorkingDays>;
  mode: SchedulingMode;
  fields: ReturnType<typeof useScheduleFields>;
}) {
  const { selectedResource, accountWorkingDays, mode, fields } = input;
  const { startDate, endDate, hoursPerDay, ignoreWeekends, daysOver, daysOfWork } = fields;
  const selectedEffectiveWeek = useMemo(
    () => (selectedResource ? effectiveWorkingWeek(selectedResource, accountWorkingDays) : undefined),
    [accountWorkingDays, selectedResource],
  );
  const values = useMemo(
    () =>
      buildEffectiveAllocationValues({
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
  return { selectedEffectiveWeek, values };
}

function resolveRepeatRange(startDate: ISODate, calendarTimeZone: string) {
  const repeatToday = todayISO(calendarTimeZone);
  return {
    repeatToday,
    repeatUntilMinimum: isValidISODate(startDate) && startDate > repeatToday ? startDate : repeatToday,
    repeatUntilMaximum: isValidISODate(startDate) ? maximumRepeatUntilDate(startDate) : undefined,
  };
}

function resolveInitialDaysOfWork(seed: AllocationModalSeed): number {
  const { editing, initialCapacityHours, initialDaysOver } = seed;
  if (editing) return roundDays(daysOfWorkFor(editing.hoursPerDay, initialDaysOver, FULL_DAY_HOURS));
  return roundDays(initialCapacityHours > 0 ? initialCapacityHours / FULL_DAY_HOURS : initialDaysOver);
}

function resolveInitialDates(seed: AllocationModalSeed, calendarTimeZone: string) {
  return {
    startDate: seed.initialStart,
    endDate: seed.editing?.endDate ?? seed.create?.endDate ?? todayISO(calendarTimeZone),
  };
}

function resolveInitialDetails(seed: AllocationModalSeed) {
  return {
    hoursPerDay: seed.editing?.hoursPerDay ?? (seed.initialScheduledHours || FULL_DAY_HOURS),
    status: seed.editing?.status ?? "confirmed",
    note: seed.editing?.note ?? "",
    task: seed.editing?.task ?? "",
    ignoreWeekends: seed.editing?.ignoreWeekends ?? false,
  };
}

function useRepeatSchedule(startDate: ISODate) {
  const [repeat, setRepeat] = useState<RepeatSelection>("none");
  const [repeatUntil, setRepeatUntil] = useState("");
  const repeatUntilIsSuggested = useRef(false);
  useEffect(() => {
    if (repeat !== "none" && repeatUntilIsSuggested.current && isValidISODate(startDate)) {
      setRepeatUntil(defaultRepeatUntilDate(startDate));
    }
  }, [repeat, startDate]);
  const changeRepeat = (value: string) => {
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
  const changeRepeatUntil = (value: string) => {
    repeatUntilIsSuggested.current = false;
    setRepeatUntil(value);
  };
  return { repeat, repeatUntil, changeRepeat, changeRepeatUntil };
}

function useScheduleFields(seed: AllocationModalSeed, calendarTimeZone: string) {
  const initialDates = resolveInitialDates(seed, calendarTimeZone);
  const initialDetails = resolveInitialDetails(seed);
  const [startDate, setStartDate] = useState<ISODate>(initialDates.startDate);
  const [endDate, setEndDate] = useState<ISODate>(initialDates.endDate);
  const [hoursPerDay, setHoursPerDay] = useState(initialDetails.hoursPerDay);
  const [status, setStatus] = useState<AllocationStatus>(initialDetails.status);
  const [note, setNote] = useState(initialDetails.note);
  const [noteEdited, setNoteEdited] = useState(false);
  const [ignoreWeekends, setIgnoreWeekends] = useState(initialDetails.ignoreWeekends);
  const [task, setTask] = useState(initialDetails.task);
  const [daysOver, setDaysOver] = useState(seed.initialDaysOver);
  const [daysOfWork, setDaysOfWork] = useState(() => resolveInitialDaysOfWork(seed));
  return {
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    hoursPerDay,
    setHoursPerDay,
    status,
    setStatus,
    note,
    setNote,
    noteEdited,
    setNoteEdited,
    task,
    setTask,
    ignoreWeekends,
    setIgnoreWeekends,
    daysOver,
    setDaysOver,
    daysOfWork,
    setDaysOfWork,
  };
}

export function useAllocationScheduleState({
  selectedResource,
  mode,
  accountWorkingDays,
  calendarTimeZone,
  seed,
}: ScheduleInput) {
  const isDays = mode === "days";
  const isBlocks = !carriesHourlyLoad(mode);
  const fields = useScheduleFields(seed, calendarTimeZone);
  const { noteEdited, ...scheduleFields } = fields;
  const { startDate, endDate, ignoreWeekends } = fields;
  const { repeat, repeatUntil, changeRepeat, changeRepeatUntil } = useRepeatSchedule(startDate);
  const { selectedEffectiveWeek, values: effectiveValues } = useEffectiveSchedule({
    selectedResource,
    accountWorkingDays,
    mode,
    fields,
  });
  const {
    external: isExternal,
    validDaysOver,
    spanFitsDateDomain,
    maximumDaysOver,
    spanLimitedByDateDomain,
    endDate: effectiveEndDate,
    hoursPerDay: effectiveHoursPerDay,
  } = effectiveValues;
  const usesTypedDateRange = isExternal || (!isBlocks && !isDays);
  // Validate typed ranges in O(1); expanding an untrusted range can freeze rendering.
  const typedDateSpanDays = startDate && endDate ? daysInclusive(startDate, endDate) : 0;
  const typedDateSpanTooLong = typedDateSpanDays > MAX_SPAN_DAYS;
  const { repeatToday, repeatUntilMinimum, repeatUntilMaximum } = resolveRepeatRange(startDate, calendarTimeZone);

  const daysOverDisabled =
    hasWorkingSpan(selectedResource, mode) && lacksEffectiveWorkingDays(selectedEffectiveWeek, ignoreWeekends);

  return {
    selectedEffectiveWeek,
    effEndDate: effectiveEndDate,
    validDaysOver,
    spanFitsDateDomain,
    spanLimitedByDateDomain,
    typedDateSpanTooLong,
    repeatToday,
    noteEdited,
    fields: {
      ...scheduleFields,
      usesTypedDateRange,
      isExternal,
      isDays,
      effHoursPerDay: effectiveHoursPerDay,
      maximumDaysOver,
      daysOverDisabled,
      repeat,
      onRepeatChange: changeRepeat,
      repeatUntil,
      onRepeatUntilChange: changeRepeatUntil,
      repeatUntilMinimum,
      repeatUntilMaximum,
    },
  };
}
