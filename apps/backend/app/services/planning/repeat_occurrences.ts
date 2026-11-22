import { normalizeCompanyWorkingDays } from '@capacitylens/shared/lib/companyWorkingDays';
import { resolveEffectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek';
import {
  generateRepeatingStartDates,
  type RepeatPattern,
} from '@capacitylens/shared/lib/repeatingDates';
import {
  buildRepeatedAllocationDrafts,
  buildRepeatedTimeOffDrafts,
} from '@capacitylens/shared/lib/repeatingOccurrences';
import { countSpanDays } from '@capacitylens/shared/lib/schedulingDays';
import type { AppData, ISODate } from '@capacitylens/shared/types/entities';
import { requireExistingRow } from '#services/planning/writer';
import { PlanningOperationException } from '#exceptions/planning_operation_exception';

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
 * @throws PlanningOperationException 400 when the repeat or a projected span is invalid.
 */
export function buildAllocationOccurrences(
  data: AppData,
  companyId: string,
  first: FirstAllocation,
  repeat: RepeatRange
): Array<{ startDate: ISODate; endDate: ISODate }> {
  const company = requireExistingRow(data, 'companies', companyId);
  const resource = requireExistingRow(data, 'resources', first.resourceId);
  const effectiveWeek = resolveEffectiveWorkingWeek(
    resource,
    normalizeCompanyWorkingDays(company.workingDays, company.weekStartsOn === 0 ? 0 : 1)
  );
  const spanOptions = {
    ...(effectiveWeek.kind === 'days' ? { workingDays: effectiveWeek.days } : {}),
    ignoreWorkingDays: first.ignoreWorkingDays,
  };
  return refuseInvalidRepeat(() => {
    const { startDates } = generateRepeatingStartDates(
      first.startDate,
      repeat.until,
      repeat.pattern
    );
    return buildRepeatedAllocationDrafts(first, startDates, {
      schedulingMode: company.schedulingMode ?? 'hourly',
      daysOver: countSpanDays(first.startDate, first.endDate, spanOptions),
      resource,
      effectiveWeek,
    }).map(({ startDate, endDate }) => ({ startDate, endDate }));
  });
}

/**
 * Dates of every occurrence, the first included, for time off repeated from `first` under the
 * time-off horizon and occurrence limit. Each occurrence keeps the first one's calendar span.
 *
 * @throws PlanningOperationException 400 when the repeat or a projected span is invalid.
 */
export function buildTimeOffOccurrences(
  first: { startDate: ISODate; endDate: ISODate },
  repeat: RepeatRange
): Array<{ startDate: ISODate; endDate: ISODate }> {
  return refuseInvalidRepeat(() =>
    buildRepeatedTimeOffDrafts(first, repeat.until, repeat.pattern).drafts.map(
      ({ startDate, endDate }) => ({ startDate, endDate })
    )
  );
}

function refuseInvalidRepeat<T>(expand: () => T): T {
  try {
    return expand();
  } catch (error) {
    // RepeatingDateError is a RangeError; both describe input the repeat cannot produce.
    if (error instanceof RangeError) {
      throw new PlanningOperationException(400, 'VALIDATION_ERROR', error.message);
    }
    throw error;
  }
}
