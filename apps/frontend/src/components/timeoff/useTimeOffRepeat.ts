import { useMemo } from 'react';
import { isValidISODate } from '@capacitylens/shared/lib/isoDates';
import {
  defaultTimeOffRepeatUntilDate,
  maximumTimeOffRepeatUntilDate,
  RepeatingDateError,
} from '@capacitylens/shared/lib/repeatingDates';
import { buildRepeatedTimeOffDrafts } from '@capacitylens/shared/lib/repeatingOccurrences';
import type { ISODate, TimeOff, TimeOffType } from '@capacitylens/shared/types/entities';
import { resolveTimeOffRepeatPattern } from '@/lib/repeatingTimeOff';
import type { TimeOffRepeatSelection } from '@/lib/repeatingTimeOff';
import { useRepeatUntil } from '@/hooks/useRepeatUntil';
import type { Draft } from '@/store/useStore';

/** Repeat cadence choices available for a time-off draft. */
export type TimeOffRepeatChoice = 'none' | TimeOffRepeatSelection;

interface TimeOffRepeatDraftInput {
  resourceId: string;
  startDate: ISODate | '';
  endDate: ISODate | '';
  type: TimeOffType;
  note: string;
}

/** Manages repeat cadence, end date, and preview state for a time-off draft. */
export function useTimeOffRepeat(input: TimeOffRepeatDraftInput) {
  const { repeat, repeatUntil, changeRepeat, changeRepeatUntil } =
    useRepeatUntil<TimeOffRepeatSelection>(input.startDate, defaultTimeOffRepeatUntilDate);

  const maximum = isValidISODate(input.startDate)
    ? maximumTimeOffRepeatUntilDate(input.startDate)
    : undefined;
  const preview = useMemo(() => {
    if (
      repeat === 'none' ||
      !isValidISODate(input.startDate) ||
      !isValidISODate(input.endDate) ||
      !isValidISODate(repeatUntil)
    ) {
      return null;
    }
    const baseDraft: Draft<TimeOff> = {
      resourceId: input.resourceId,
      startDate: input.startDate,
      endDate: input.endDate,
      type: input.type,
      ...(input.note ? { note: input.note } : {}),
    };
    try {
      return buildRepeatedTimeOffDrafts(
        baseDraft,
        repeatUntil,
        resolveTimeOffRepeatPattern(repeat),
      );
    } catch (error) {
      if (error instanceof RepeatingDateError) {
        // Invalid repeat settings have no preview, so the form stays editable while the user corrects them.
        return null;
      }
      throw error;
    }
  }, [
    input.endDate,
    input.note,
    input.resourceId,
    input.startDate,
    input.type,
    repeat,
    repeatUntil,
  ]);

  return { repeat, repeatUntil, maximum, preview, changeRepeat, changeRepeatUntil };
}
