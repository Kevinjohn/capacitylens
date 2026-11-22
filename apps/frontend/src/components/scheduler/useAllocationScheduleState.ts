import type { normalizeCompanyWorkingDays } from '@capacitylens/shared/lib/companyWorkingDays';
import { countDaysInclusive } from '@capacitylens/shared/lib/dateMath';
import {
  resolveEffectiveWorkingWeek,
  hasNoEffectiveWorkingDays,
} from '@capacitylens/shared/lib/effectiveWorkingWeek';
import { isValidISODate } from '@capacitylens/shared/lib/isoDates';
import {
  resolveDefaultRepeatUntilDate,
  resolveMaximumRepeatUntilDate,
} from '@capacitylens/shared/lib/repeatingDates';
import { calculateDaysOfWork, MAX_SPAN_DAYS } from '@capacitylens/shared/lib/schedulingDays';
import type {
  AllocationStatus,
  ISODate,
  Resource,
  SchedulingMode,
} from '@capacitylens/shared/types/entities';
import { hasHourlyLoad, FULL_DAY_HOURS } from '@capacitylens/shared/types/entities';
import { useMemo, useState } from 'react';
import type { RepeatSelection } from '@/lib/repeatingAllocations';
import { useRepeatUntil } from '@/hooks/useRepeatUntil';

import type { AllocationDialogSeed } from './buildAllocationDialogSeed';
import {
  buildEffectiveAllocationValues,
  roundDays,
  hasWorkingSpan,
} from './allocationDialogSelection';
interface ScheduleInput {
  selectedResource: Resource | undefined;
  mode: SchedulingMode;
  companyWorkingDays: ReturnType<typeof normalizeCompanyWorkingDays>;
  today: ISODate;
  seed: AllocationDialogSeed;
}

function useEffectiveSchedule(input: {
  selectedResource: Resource | undefined;
  companyWorkingDays: ReturnType<typeof normalizeCompanyWorkingDays>;
  mode: SchedulingMode;
  fields: ReturnType<typeof useScheduleFields>;
}) {
  const { selectedResource, companyWorkingDays, mode, fields } = input;
  const { startDate, endDate, hoursPerDay, ignoreWorkingDays, daysOver, daysOfWork } = fields;
  const selectedEffectiveWeek = useMemo(
    () =>
      selectedResource
        ? resolveEffectiveWorkingWeek(selectedResource, companyWorkingDays)
        : undefined,
    [companyWorkingDays, selectedResource],
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
        ignoreWorkingDays,
      }),
    [
      daysOfWork,
      daysOver,
      endDate,
      hoursPerDay,
      ignoreWorkingDays,
      mode,
      selectedEffectiveWeek,
      selectedResource,
      startDate,
    ],
  );
  return { selectedEffectiveWeek, values };
}

function resolveRepeatRange(startDate: ISODate, repeatToday: ISODate) {
  return {
    repeatToday,
    repeatUntilMinimum:
      isValidISODate(startDate) && startDate > repeatToday ? startDate : repeatToday,
    repeatUntilMaximum: isValidISODate(startDate)
      ? resolveMaximumRepeatUntilDate(startDate)
      : undefined,
  };
}

function resolveInitialDaysOfWork(seed: AllocationDialogSeed): number {
  const { editing, initialCapacityHours, initialDaysOver } = seed;
  if (editing) {
    return roundDays(calculateDaysOfWork(editing.hoursPerDay, initialDaysOver, FULL_DAY_HOURS));
  }
  return roundDays(
    initialCapacityHours > 0 ? initialCapacityHours / FULL_DAY_HOURS : initialDaysOver,
  );
}

function resolveInitialDates(seed: AllocationDialogSeed, today: ISODate) {
  return {
    startDate: seed.initialStart,
    endDate: seed.editing?.endDate ?? seed.create?.endDate ?? today,
  };
}

function resolveInitialDetails(seed: AllocationDialogSeed) {
  return {
    hoursPerDay: seed.editing?.hoursPerDay ?? (seed.initialScheduledHours || FULL_DAY_HOURS),
    status: seed.editing?.status ?? 'confirmed',
    note: seed.editing?.note ?? '',
    task: seed.editing?.task ?? '',
    ignoreWorkingDays: seed.editing?.ignoreWorkingDays ?? false,
  };
}

function useScheduleFields(seed: AllocationDialogSeed, today: ISODate) {
  const initialDates = resolveInitialDates(seed, today);
  const initialDetails = resolveInitialDetails(seed);
  const [startDate, setStartDate] = useState<ISODate>(initialDates.startDate);
  const [endDate, setEndDate] = useState<ISODate>(initialDates.endDate);
  const [hoursPerDay, setHoursPerDay] = useState(initialDetails.hoursPerDay);
  const [status, setStatus] = useState<AllocationStatus>(initialDetails.status);
  const [note, setNote] = useState(initialDetails.note);
  const [noteEdited, setNoteEdited] = useState(false);
  const [ignoreWorkingDays, setIgnoreWorkingDays] = useState(initialDetails.ignoreWorkingDays);
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
    ignoreWorkingDays,
    setIgnoreWorkingDays,
    daysOver,
    setDaysOver,
    daysOfWork,
    setDaysOfWork,
  };
}

/** Tracks dates, quantity, and repeat choices for an allocation draft. */
export function useAllocationScheduleState({
  selectedResource,
  mode,
  companyWorkingDays,
  today,
  seed,
}: ScheduleInput) {
  const isDays = mode === 'days';
  const isBlocks = !hasHourlyLoad(mode);
  const fields = useScheduleFields(seed, today);
  const { noteEdited, ...scheduleFields } = fields;
  const { startDate, endDate, ignoreWorkingDays } = fields;
  const { repeat, repeatUntil, changeRepeat, changeRepeatUntil } = useRepeatUntil<RepeatSelection>(
    startDate,
    resolveDefaultRepeatUntilDate,
  );
  const { selectedEffectiveWeek, values: effectiveValues } = useEffectiveSchedule({
    selectedResource,
    companyWorkingDays,
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
  const typedDateSpanDays = startDate && endDate ? countDaysInclusive(startDate, endDate) : 0;
  const typedDateSpanTooLong = typedDateSpanDays > MAX_SPAN_DAYS;
  const { repeatToday, repeatUntilMinimum, repeatUntilMaximum } = resolveRepeatRange(
    startDate,
    today,
  );

  const daysOverDisabled =
    hasWorkingSpan(selectedResource, mode) &&
    hasNoEffectiveWorkingDays(selectedEffectiveWeek, ignoreWorkingDays);

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
