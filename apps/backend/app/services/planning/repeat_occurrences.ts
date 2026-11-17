import { normalizeAccountWorkingDays } from '@capacitylens/shared/lib/accountWorkingDays';
import { effectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek';
import {
  generateRepeatingStartDates,
  type RepeatPattern,
} from '@capacitylens/shared/lib/repeatingDates';
import { buildRepeatedAllocationDrafts } from '@capacitylens/shared/lib/repeatingOccurrences';
import { spanDays } from '@capacitylens/shared/lib/schedulingDays';
import type { AppData, ISODate } from '@capacitylens/shared/types/entities';
import { existingRow, PlanningOperationError } from './writer.js';

// The server's expansion of a repeat pattern into dated occurrences, using the shared rules.

/** A repeat's pattern and its inclusive last start date. */
export interface RepeatRange {
  pattern: RepeatPattern;
  until: ISODate;
}

/** The first occurrence's fields that decide where later occurrences fall. */
interface FirstAllocation {
  resourceId: string;
  startDate: ISODate;
  endDate: ISODate;
  ignoreWorkingDays?: boolean | null;
}

/**
 * Dates of every occurrence, the first included, for an allocation repeated from `first`.
 * A working-span company keeps the first occurrence's count of working days; an hourly company or
 * an external resource keeps its calendar span.
 *
 * @throws PlanningOperationError 400 when the repeat or a projected span is invalid.
 */
export function allocationOccurrences(
  data: AppData,
  accountId: string,
  first: FirstAllocation,
  repeat: RepeatRange
): Array<{ startDate: ISODate; endDate: ISODate }> {
  const account = existingRow(data, 'accounts', accountId);
  const resource = existingRow(data, 'resources', first.resourceId);
  const effectiveWeek = effectiveWorkingWeek(
    resource,
    normalizeAccountWorkingDays(account.workingDays, account.weekStartsOn === 0 ? 0 : 1)
  );
  const spanOptions = {
    ...(effectiveWeek.kind === 'days' ? { workingDays: effectiveWeek.days } : {}),
    ignoreWorkingDays: first.ignoreWorkingDays,
  };
  try {
    const { startDates } = generateRepeatingStartDates(
      first.startDate,
      repeat.until,
      repeat.pattern
    );
    return buildRepeatedAllocationDrafts(first, startDates, {
      schedulingMode: account.schedulingMode ?? 'hourly',
      daysOver: spanDays(first.startDate, first.endDate, spanOptions),
      resource,
      effectiveWeek,
    }).map(({ startDate, endDate }) => ({ startDate, endDate }));
  } catch (error) {
    // RepeatingDateError is a RangeError; both describe input the repeat cannot produce.
    if (error instanceof RangeError) {
      throw new PlanningOperationError(400, 'VALIDATION_ERROR', error.message);
    }
    throw error;
  }
}
