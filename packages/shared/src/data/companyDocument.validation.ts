import { MAX_HOURS_PER_DAY } from '../types/entityKeys.js';
import type { AppDataKey, Weekday } from '../types/entities.js';
import { INTERNAL_CLIENT_COLOR } from './internalClient.js';
import { NEUTRAL_COLOR, isPresetColor } from '../lib/color.js';
import { validateDateRange } from '../lib/integrity.js';
import { isValidISODate, parseISOTimestamp } from '../lib/isoDates.js';
import {
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  hasDisallowedChars,
  normalizeUserText,
  countUnicodeCharacters,
} from '../lib/strings.js';
import { parseResourceAvatarUrl } from '../domain/resourceAvatarUrl.js';
import { areHalfDaysWithinWorkingDays, isSameWeekdays } from '../domain/resourceWorkingPattern.js';
import {
  ACTIVITY_KINDS,
  ALLOCATION_STATUSES,
  CAPACITY_OVERVIEW_ACCESS_VALUES,
  DATE_STYLES,
  EMPLOYMENT_TYPES,
  RESOURCE_ENGAGEMENTS,
  RESOURCE_KINDS,
  SCHEDULING_MODES,
  TIME_OFF_TYPES,
  buildExternalCapacityDefaults,
  buildPlaceholderCapacityDefaults,
} from '../types/entities.js';
import { isRecord } from '../lib/isRecord.js';
import { assert, isId, isOneOf, hasOwn } from './companyDocument.errors.js';
import { FIELDS } from './companyDocument.fields.js';
import type { Row } from './companyDocument.fields.js';

const weekdays = [0, 1, 2, 3, 4, 5, 6];
const isNullOr = (value: unknown, test: (candidate: unknown) => boolean) =>
  value === null || test(value);
const isString = (value: unknown) => typeof value === 'string';
const isBoolean = (value: unknown) => typeof value === 'boolean';
const isFiniteNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const isTimestamp = (value: unknown) => parseISOTimestamp(value) !== null;
const isDayList = (value: unknown): value is Weekday[] =>
  Array.isArray(value) &&
  value.every((day: unknown) => typeof day === 'number' && weekdays.includes(day)) &&
  new Set(value).size === value.length;

function assertText(
  value: Row,
  field: string,
  path: string,
  options: { allowEmpty?: boolean; multiline?: boolean; maxLength?: number } = {},
): void {
  const text = value[field];
  assert(typeof text === 'string', `${path}.${field}`, 'must be a string');
  assert(
    options.allowEmpty === true || text.trim().length > 0,
    `${path}.${field}`,
    'must be a non-empty string',
  );
  assert(
    countUnicodeCharacters(text) <=
      (options.maxLength ?? (options.multiline ? MAX_NOTE_LENGTH : MAX_NAME_LENGTH)),
    `${path}.${field}`,
    'is too long',
  );
  const textOptions = options.multiline === undefined ? {} : { multiline: options.multiline };
  assert(
    !hasDisallowedChars(text, textOptions),
    `${path}.${field}`,
    'contains unsupported characters',
  );
  assert(
    text === normalizeUserText(text, textOptions),
    `${path}.${field}`,
    'must already use canonical text spacing and Unicode',
  );
}

function assertNullableText(
  value: Row,
  field: string,
  path: string,
  options: { multiline?: boolean } = {},
): void {
  assert(isNullOr(value[field], isString), `${path}.${field}`, 'must be a string or null');
  if (typeof value[field] === 'string') {
    assertText(value, field, path, { allowEmpty: true, ...options });
  }
}

function assertNullableId(value: Row, field: string, path: string): void {
  assert(isNullOr(value[field], isId), `${path}.${field}`, 'must be a bounded id or null');
}

function assertNullableTimestamp(value: Row, field: string, path: string): void {
  assert(
    isNullOr(value[field], isTimestamp),
    `${path}.${field}`,
    'must be a valid ISO timestamp or null',
  );
}

function assertColor(value: Row, field: string, path: string, systemColor?: string): void {
  assert(
    (systemColor !== undefined && value[field] === systemColor) || isPresetColor(value[field]),
    `${path}.${field}`,
    'must be a preset colour',
  );
}

type RowLimits = { nameMaximum: number };

function assertCompanyRow(row: Row, path: string): void {
  assertText(row, 'name', path);
  assertColor(row, 'color', path);
  assert(
    isNullOr(row.schedulingMode, (v) => isOneOf(v, SCHEDULING_MODES)),
    `${path}.schedulingMode`,
    'is invalid',
  );
  assert(
    isNullOr(row.timezone, (v) => {
      if (typeof v !== 'string') return false;
      try {
        new Intl.DateTimeFormat('en', { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
    `${path}.timezone`,
    'must be a valid time zone or null',
  );
  assert(
    isNullOr(row.weekStartsOn, (v) => v === 0 || v === 1),
    `${path}.weekStartsOn`,
    'must be 0, 1 or null',
  );
  assert(
    isNullOr(row.workingDays, isDayList),
    `${path}.workingDays`,
    'must be a unique weekday list or null',
  );
  assert(
    row.workingDays === null || (row.workingDays as unknown[]).length > 0,
    `${path}.workingDays`,
    'must contain at least one working day when supplied',
  );
  assert(row.language === null || row.language === 'en', `${path}.language`, 'must be en or null');
  for (const field of [
    'disciplinesEnabled',
    'placeholdersEnabled',
    'externalEnabled',
    'inlineActivityCreateEnabled',
    'showTaskFieldInSchedule',
  ]) {
    assert(isNullOr(row[field], isBoolean), `${path}.${field}`, 'must be boolean or null');
  }
  assert(
    isNullOr(row.capacityOverviewAccess, (v) => isOneOf(v, CAPACITY_OVERVIEW_ACCESS_VALUES)),
    `${path}.capacityOverviewAccess`,
    'is invalid',
  );
  assert(
    isNullOr(row.dateStyle, (v) => isOneOf(v, DATE_STYLES)),
    `${path}.dateStyle`,
    'is invalid',
  );
}

function assertDisciplineRow(row: Row, path: string): void {
  assertText(row, 'name', path);
  assert(isNullOr(row.color, isPresetColor), `${path}.color`, 'must be a preset colour or null');
  assert(Number.isSafeInteger(row.sortOrder), `${path}.sortOrder`, 'must be a safe integer');
}

function assertResourceRow(row: Row, path: string): void {
  assert(isOneOf(row.kind, RESOURCE_KINDS), `${path}.kind`, 'is invalid');
  assertNullableText(row, 'name', path);
  assertText(row, 'role', path, { allowEmpty: true });
  assert(isNullOr(row.avatarUrl, isString), `${path}.avatarUrl`, 'must be a string or null');
  assertNullableId(row, 'disciplineId', path);
  assert(isOneOf(row.employmentType, EMPLOYMENT_TYPES), `${path}.employmentType`, 'is invalid');
  assert(isOneOf(row.engagement, RESOURCE_ENGAGEMENTS), `${path}.engagement`, 'is invalid');
  assert(
    isFiniteNumber(row.workingHoursPerDay) &&
      (row.workingHoursPerDay as number) > 0 &&
      (row.workingHoursPerDay as number) <= 24,
    `${path}.workingHoursPerDay`,
    'must be greater than 0 and at most 24',
  );
  assert(
    isDayList(row.workingDays) && isDayList(row.halfDays),
    path,
    'workingDays and halfDays must be unique weekday lists',
  );
  assert(
    areHalfDaysWithinWorkingDays(row.workingDays, row.halfDays),
    `${path}.halfDays`,
    'must be a subset of workingDays',
  );
  assertNullableId(row, 'projectId', path);
  assertColor(row, 'color', path, row.kind === 'external' ? NEUTRAL_COLOR : undefined);
  assert(isNullOr(row.isFavourite, isBoolean), `${path}.isFavourite`, 'must be boolean or null');
  for (const field of ['firstAvailableDate', 'lastAvailableDate']) {
    assert(
      isNullOr(row[field], isValidISODate),
      `${path}.${field}`,
      'must be a valid date or null',
    );
  }
  assertNullableTimestamp(row, 'archivedAt', path);
  assertNullableTimestamp(row, 'deletedAt', path);
  if (row.kind === 'person' || row.kind === 'external') assertText(row, 'name', path);
  if (row.kind === 'person') {
    assert(
      row.workingDays.length > 0 && (row.workingHoursPerDay as number) > 0,
      path,
      'a person must have working days and positive daily capacity',
    );
  }
  if (row.kind !== 'placeholder') {
    assert(
      row.projectId === null,
      `${path}.projectId`,
      'only a placeholder may be bound to a project',
    );
  }
  if (row.kind !== 'person') {
    assert(row.avatarUrl === null, `${path}.avatarUrl`, 'only a person may have an avatar URL');
    for (const field of ['firstAvailableDate', 'lastAvailableDate']) {
      assert(row[field] === null, `${path}.${field}`, 'only a person may have availability dates');
    }
  }
  if (row.kind === 'person' && row.avatarUrl !== null) {
    assert(
      parseResourceAvatarUrl(row.avatarUrl) === row.avatarUrl,
      `${path}.avatarUrl`,
      'must be a canonical credential-free HTTPS URL',
    );
  }
  if (row.kind === 'placeholder') {
    assert(row.engagement === 'studio', `${path}.engagement`, 'must be studio for a placeholder');
    const defaults = buildPlaceholderCapacityDefaults();
    assert(
      isSameWeekdays(row.workingDays, defaults.workingDays) &&
        isSameWeekdays(row.halfDays, defaults.halfDays),
      path,
      'placeholder working pattern must use its canonical default',
    );
  }
  if (row.kind === 'external') {
    assert(row.disciplineId === null, `${path}.disciplineId`, 'is not used by external resources');
    const defaults = buildExternalCapacityDefaults();
    assert(
      row.color === NEUTRAL_COLOR &&
        row.employmentType === defaults.employmentType &&
        row.engagement === defaults.engagement &&
        row.workingHoursPerDay === defaults.workingHoursPerDay &&
        isSameWeekdays(row.workingDays, defaults.workingDays) &&
        isSameWeekdays(row.halfDays, defaults.halfDays),
      path,
      'external resource must use its canonical capacity defaults',
    );
  }
}

function assertClientRow(row: Row, path: string, { nameMaximum }: RowLimits): void {
  assertText(row, 'name', path, { maxLength: nameMaximum });
  assertColor(row, 'color', path, row.builtin === true ? INTERNAL_CLIENT_COLOR : undefined);
  assert(isNullOr(row.isPrivate, isBoolean), `${path}.isPrivate`, 'must be boolean or null');
  if (hasOwn(row, 'codeName')) assertNullableText(row, 'codeName', path);
  assert(isNullOr(row.builtin, isBoolean), `${path}.builtin`, 'must be boolean or null');
  assertNullableTimestamp(row, 'archivedAt', path);
  assertNullableTimestamp(row, 'deletedAt', path);
  if (row.builtin === true) {
    assert(
      (row.isPrivate === null || row.isPrivate === false) && row.codeName === null,
      path,
      'Internal must remain public and have no code name',
    );
  }
}

function assertProjectRow(row: Row, path: string, { nameMaximum }: RowLimits): void {
  assertText(row, 'name', path, { maxLength: nameMaximum });
  assert(isId(row.clientId), `${path}.clientId`, 'must be a bounded id');
  assertColor(row, 'color', path);
  assert(isNullOr(row.isPrivate, isBoolean), `${path}.isPrivate`, 'must be boolean or null');
  if (hasOwn(row, 'codeName')) assertNullableText(row, 'codeName', path);
  assertNullableTimestamp(row, 'archivedAt', path);
  assertNullableTimestamp(row, 'deletedAt', path);
}

function assertPhaseRow(row: Row, path: string): void {
  assertText(row, 'name', path);
  assert(isId(row.projectId), `${path}.projectId`, 'must be a bounded id');
}

function assertActivityRow(row: Row, path: string): void {
  assertText(row, 'name', path);
  assert(isOneOf(row.kind, ACTIVITY_KINDS), `${path}.kind`, 'is invalid');
  assertNullableId(row, 'projectId', path);
  assertNullableId(row, 'phaseId', path);
  assertNullableTimestamp(row, 'archivedAt', path);
  assertNullableTimestamp(row, 'deletedAt', path);
  assert(
    row.kind === 'project'
      ? row.projectId !== null
      : row.projectId === null && row.phaseId === null,
    path,
    'activity kind and project/phase references do not agree',
  );
}

function assertAllocationRow(row: Row, path: string): void {
  for (const field of ['resourceId', 'activityId']) {
    assert(isId(row[field]), `${path}.${field}`, 'must be a bounded id');
  }
  assertNullableId(row, 'projectId', path);
  assertNullableId(row, 'seriesId', path);
  assert(
    validateDateRange(row.startDate as never, row.endDate as never).ok,
    path,
    'allocation date range is invalid',
  );
  assert(
    isFiniteNumber(row.hoursPerDay) &&
      (row.hoursPerDay as number) >= 0 &&
      (row.hoursPerDay as number) <= MAX_HOURS_PER_DAY,
    `${path}.hoursPerDay`,
    'is outside the supported range',
  );
  assert(isOneOf(row.status, ALLOCATION_STATUSES), `${path}.status`, 'is invalid');
  assertNullableText(row, 'note', path, { multiline: true });
  assertNullableText(row, 'task', path);
  assert(
    isNullOr(row.ignoreWorkingDays, isBoolean),
    `${path}.ignoreWorkingDays`,
    'must be boolean or null',
  );
}

function assertTimeOffRow(row: Row, path: string): void {
  assert(isId(row.resourceId), `${path}.resourceId`, 'must be a bounded id');
  assert(
    validateDateRange(row.startDate as never, row.endDate as never).ok,
    path,
    'time-off date range is invalid',
  );
  assert(isOneOf(row.type, TIME_OFF_TYPES), `${path}.type`, 'is invalid');
  assertNullableText(row, 'note', path, { multiline: true });
}

function assertClosureRow(row: Row, path: string): void {
  assertText(row, 'name', path);
  assert(
    validateDateRange(row.startDate as never, row.endDate as never).ok,
    path,
    'closure date range is invalid',
  );
}

/** The table-specific field rules, one validator per export table. */
const rowRules: { [K in AppDataKey]: (row: Row, path: string, limits: RowLimits) => void } = {
  companies: assertCompanyRow,
  disciplines: assertDisciplineRow,
  resources: assertResourceRow,
  clients: assertClientRow,
  projects: assertProjectRow,
  phases: assertPhaseRow,
  activities: assertActivityRow,
  allocations: assertAllocationRow,
  timeOff: assertTimeOffRow,
  closures: assertClosureRow,
};

/**
 * Checks every supplied scalar field without coercing or mutating the row.
 *
 * @throws CompanyDocumentError naming the first invalid field.
 */
export function assertRow(
  key: AppDataKey,
  input: unknown,
  path: string,
  options: { redacted: boolean },
): asserts input is Row {
  assert(isRecord(input), path, 'must be an object');
  const row = input;
  for (const field of FIELDS[key] as readonly string[]) {
    assert(hasOwn(row, field), `${path}.${field}`, 'is required');
  }
  assert(isId(row.id), `${path}.id`, 'must be a bounded non-empty id without whitespace');
  assert(isTimestamp(row.createdAt), `${path}.createdAt`, 'must be an ISO timestamp');
  assert(isTimestamp(row.updatedAt), `${path}.updatedAt`, 'must be an ISO timestamp');
  if (key !== 'companies') {
    assert(
      isId(row.companyId),
      `${path}.companyId`,
      'must be a bounded non-empty id without whitespace',
    );
  }
  // Private-name projections add two quotation marks to the stored code name.
  const nameMaximum =
    options.redacted && row.isPrivate === true ? MAX_NAME_LENGTH + 2 : MAX_NAME_LENGTH;
  rowRules[key](row, path, { nameMaximum });
}
