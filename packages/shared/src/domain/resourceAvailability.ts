import { listDaysISO, getWeekday } from '../lib/dateMath.js';
import { resolveEffectiveWorkingWeek, hasEffectiveWeekDay } from '../lib/effectiveWorkingWeek.js';
import { isValidISODate } from '../lib/isoDates.js';
import type { ValidationResult } from '../lib/integrity.js';
import { isExternalResource, isPlaceholderResource } from '../types/entities.js';
import type { Allocation, ISODate, Resource, Weekday } from '../types/entities.js';
import { throwDomainError } from './errors.js';

/** The allocation span, resource and company working days an availability check needs. */
export interface ResourceAvailabilityInput {
  allocation: Pick<Allocation, 'startDate' | 'endDate'> &
    Partial<Pick<Allocation, 'ignoreWorkingDays'>>;
  resource: Pick<Resource, 'kind' | 'workingDays'> &
    Partial<Pick<Resource, 'firstAvailableDate' | 'lastAvailableDate'>>;
  /** Company working days are required so boundaries only apply to days on which this person is
   * actually schedulable. The intersection is also the same calendar used by capacity math. */
  companyWorkingDays: Weekday[];
}

/** Enforce inclusive person availability on scheduled days without mutating the input.
 * Dates must be validated ISO dates and the allocation range must fit the materialization limit.
 * Placeholders and external resources are exempt; person days use the effective working week unless ignoreWorkingDays is true.
 * @throws DomainError when a scheduled day falls outside availability; do not persist the allocation. */
export function assertAllocationWithinResourceAvailability({
  allocation,
  resource,
  companyWorkingDays,
}: ResourceAvailabilityInput): void {
  if (isPlaceholderResource(resource) || isExternalResource(resource)) return;
  const first = resource.firstAvailableDate;
  const last = resource.lastAvailableDate;
  if (first == null && last == null) return;
  const effectiveWeek = resolveEffectiveWorkingWeek(resource, companyWorkingDays);
  const scheduledDates = listDaysISO(allocation.startDate, allocation.endDate).filter(
    (date) =>
      allocation.ignoreWorkingDays === true || hasEffectiveWeekDay(effectiveWeek, getWeekday(date)),
  );
  for (const date of scheduledDates) {
    if (first != null && date < first) {
      throwDomainError(
        'E_ALLOCATION_BEFORE_RESOURCE_AVAILABILITY',
        'Allocation includes a scheduled working day before this person is available.',
      );
    }
    if (last != null && date > last) {
      throwDomainError(
        'E_ALLOCATION_AFTER_RESOURCE_AVAILABILITY',
        'Allocation includes a scheduled working day after this person is available.',
      );
    }
  }
}

/** Validate a person availability pair without applying the allocation placement rules. */
export function validateResourceAvailabilityPair(
  firstAvailableDate?: ISODate | null,
  lastAvailableDate?: ISODate | null,
): ValidationResult {
  if (
    (firstAvailableDate != null && !isValidISODate(firstAvailableDate)) ||
    (lastAvailableDate != null && !isValidISODate(lastAvailableDate))
  ) {
    return {
      ok: false,
      errors: ['Availability dates must be valid calendar dates (YYYY-MM-DD).'],
      codes: ['E_DATE_INVALID'],
    };
  }
  if (
    firstAvailableDate != null &&
    lastAvailableDate != null &&
    firstAvailableDate > lastAvailableDate
  ) {
    return {
      ok: false,
      errors: ['First available date cannot be after last available date.'],
      codes: ['E_DATE_REVERSED'],
    };
  }
  return { ok: true, errors: [], codes: [] };
}
