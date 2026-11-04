import type { AppData } from '@capacitylens/shared/types/entities';
import {
  assertActivityProjectAllowsDependents,
  assertDateRange,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertResourceProjectAllowsDependents,
  assertScopedRefs,
  validateResourceAvailabilityPair,
} from '@capacitylens/shared/domain/mutations';
import { hasUsablePrivateCodeName } from '@capacitylens/shared/domain/privateNames';
import { DomainError } from '@capacitylens/shared/domain/errors';
import { isBuiltinClient } from '@capacitylens/shared/data/internalClient';
import {
  fixedWorkingPattern,
  halfDaysWithinWorkingDays,
  sameWeekdays,
} from '@capacitylens/shared/domain/resourceWorkingPattern';
import { isWeekdaySet } from '@capacitylens/shared/lib/accountWorkingDays';
import type { Activity, Resource, TimeOff } from '@capacitylens/shared/types/entities';
import { invalid } from './volatileRows';
import type { Row } from './volatileRows';

// Demo-mode checks that mirror the server's merged-row validation for each entity.

function assertWorkingPattern(resource: Resource): void {
  if (!isWeekdaySet(resource.workingDays) || resource.workingDays.length === 0) {
    throw invalid(
      'At least one working day is required, using unique whole-number weekdays from 0 to 6.',
    );
  }
  if (
    !isWeekdaySet(resource.halfDays) ||
    !halfDaysWithinWorkingDays(resource.workingDays, resource.halfDays)
  ) {
    throw invalid('Half days must be unique whole-number weekdays contained in the working week.');
  }
  const [availabilityCode] = validateResourceAvailabilityPair(
    resource.firstAvailableDate,
    resource.lastAvailableDate,
  ).codes;
  if (availabilityCode) {
    throw invalid(
      availabilityCode === 'date_reversed'
        ? 'End date cannot be before the start date.'
        : 'Availability dates must be valid calendar dates (YYYY-MM-DD).',
    );
  }
}

export function validateCatalogue(
  data: AppData,
  companyId: string,
  key: 'clients' | 'projects' | 'phases' | 'activities' | 'disciplines',
  fields: Record<string, unknown>,
  previous?: Row,
): void {
  const merged = { ...previous, ...fields };
  if ((key === 'clients' || key === 'projects') && !hasUsablePrivateCodeName(merged)) {
    throw invalid(`A private ${key === 'clients' ? 'client' : 'project'} requires a code name.`);
  }
  if (key === 'clients' && previous && isBuiltinClient(previous as never)) {
    throw invalid('The Internal client is built in and cannot be renamed.');
  }
  assertScopedRefs(data, companyId, key, key === 'activities' ? merged : fields, previous);
  if (key === 'activities' && previous) {
    assertActivityProjectAllowsDependents(
      data,
      companyId,
      previous.id,
      merged as unknown as Activity,
      previous as unknown as Activity,
    );
  }
}

export function validateResource(
  data: AppData,
  companyId: string,
  fields: Record<string, unknown>,
  previous?: Row,
): void {
  const merged = { ...previous, ...fields } as unknown as Resource;
  assertScopedRefs(data, companyId, 'resources', fields, previous);
  if (
    merged.kind === 'placeholder' &&
    Object.hasOwn(fields, 'engagement') &&
    merged.engagement !== 'studio'
  ) {
    throw invalid('A placeholder must use Studio engagement.');
  }
  const pattern = fixedWorkingPattern(merged.kind);
  for (const key of ['workingDays', 'halfDays'] as const) {
    if (pattern && Object.hasOwn(fields, key) && !sameWeekdays(merged[key], pattern[key])) {
      const owner = merged.kind === 'external' ? 'An external resource' : 'A placeholder';
      throw invalid(`${owner}'s ${key} must match its default working pattern.`);
    }
  }
  assertWorkingPattern(merged);
  if (previous) {
    assertResourceProjectAllowsDependents(
      data,
      companyId,
      previous.id,
      merged,
      previous as unknown as Resource,
    );
    assertResourceKindAllowsDependents(data, companyId, previous.id, merged.kind);
  }
}

export function validateTimeOff(
  data: AppData,
  companyId: string,
  fields: Record<string, unknown>,
  previous?: Row,
): void {
  const merged = { ...previous, ...fields } as unknown as TimeOff;
  assertResourceExists(
    data,
    companyId,
    merged.resourceId,
    previous as unknown as TimeOff | undefined,
  );
  assertDateRange(merged.startDate, merged.endDate);
}

export function validateClosure(fields: Record<string, unknown>, previous?: Row): void {
  const merged = { ...previous, ...fields };
  if (typeof merged.name !== 'string' || merged.name.trim().length === 0) {
    throw new DomainError('closure_name_required', 'Closure name is required.');
  }
  assertDateRange(merged.startDate as string | undefined, merged.endDate as string | undefined);
}
