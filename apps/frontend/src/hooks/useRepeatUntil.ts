import { useEffect, useRef, useState } from 'react';
import { isValidISODate } from '@capacitylens/shared/lib/isoDates';
import type { ISODate } from '@capacitylens/shared/types/entities';

/**
 * Holds a create form's repeat choice and its "repeat until" date.
 *
 * @remarks Switching repeat on always marks the end date as a suggestion. A suggestion is filled
 * from `suggestRepeatUntil` once the start date is valid, even when repeat was switched on first,
 * and follows later start-date changes until the user edits the end date. Switching repeat off
 * clears it.
 */
export function useRepeatUntil<S extends string>(
  startDate: ISODate | '',
  suggestRepeatUntil: (startDate: ISODate) => ISODate,
) {
  const [repeat, setRepeat] = useState<S | 'none'>('none');
  const [repeatUntil, setRepeatUntil] = useState<ISODate | ''>('');
  const repeatUntilIsSuggested = useRef(false);

  useEffect(() => {
    if (repeat !== 'none' && repeatUntilIsSuggested.current && isValidISODate(startDate)) {
      setRepeatUntil(suggestRepeatUntil(startDate));
    }
  }, [repeat, startDate, suggestRepeatUntil]);

  const changeRepeat = (value: string) => {
    const next = value as S | 'none';
    if (repeat === 'none' && next !== 'none') {
      repeatUntilIsSuggested.current = true;
      if (isValidISODate(startDate)) setRepeatUntil(suggestRepeatUntil(startDate));
    } else if (next === 'none') {
      repeatUntilIsSuggested.current = false;
      setRepeatUntil('');
    }
    setRepeat(next);
  };

  const changeRepeatUntil = (value: string) => {
    repeatUntilIsSuggested.current = false;
    setRepeatUntil(value);
  };

  return { repeat, repeatUntil, changeRepeat, changeRepeatUntil };
}
