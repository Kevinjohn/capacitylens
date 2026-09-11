import { useEffect, useMemo, useRef, useState } from "react";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import { defaultTimeOffRepeatUntilDate, maximumTimeOffRepeatUntilDate } from "@capacitylens/shared/lib/repeatingDates";
import type { ISODate, TimeOff, TimeOffType } from "@capacitylens/shared/types/entities";
import { buildRepeatedTimeOffDrafts, type TimeOffRepeatSelection } from "../../lib/repeatingTimeOff";
import type { Draft } from "../../store/useStore";

export type TimeOffRepeatChoice = "none" | TimeOffRepeatSelection;

interface TimeOffRepeatDraftInput {
  resourceId: string;
  startDate: ISODate | "";
  endDate: ISODate | "";
  type: TimeOffType;
  note: string;
}

export function useTimeOffRepeat(input: TimeOffRepeatDraftInput) {
  const [repeat, setRepeat] = useState<TimeOffRepeatChoice>("none");
  const [repeatUntil, setRepeatUntil] = useState<ISODate | "">("");
  const repeatUntilIsSuggested = useRef(false);

  useEffect(() => {
    if (repeat !== "none" && repeatUntilIsSuggested.current && isValidISODate(input.startDate)) {
      setRepeatUntil(defaultTimeOffRepeatUntilDate(input.startDate));
    }
  }, [input.startDate, repeat]);

  const changeRepeat = (value: string) => {
    const next = value as TimeOffRepeatChoice;
    if (repeat === "none" && next !== "none") {
      repeatUntilIsSuggested.current = true;
      if (isValidISODate(input.startDate)) setRepeatUntil(defaultTimeOffRepeatUntilDate(input.startDate));
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

  const maximum = isValidISODate(input.startDate) ? maximumTimeOffRepeatUntilDate(input.startDate) : undefined;
  const preview = useMemo(() => {
    if (
      repeat === "none" ||
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
      return buildRepeatedTimeOffDrafts(baseDraft, repeatUntil, repeat);
    } catch {
      return null;
    }
  }, [input.endDate, input.note, input.resourceId, input.startDate, input.type, repeat, repeatUntil]);

  return { repeat, repeatUntil, maximum, preview, changeRepeat, changeRepeatUntil };
}
