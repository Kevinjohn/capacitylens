import { daysInclusive } from './dateMath.js';
import { MAX_SPAN_DAYS } from './schedulingDays.js';
import type { DomainErrorCode } from '../domain/errors.js';
import type { Activity, Allocation, ID, ISODate, Resource } from '../types/entities.js';
import { isValidISODate } from './isoDates.js';

// Keep referential-integrity validation pure. Calendar parsing lives in isoDates.

/** Outcome of a validation: `ok`, display-safe `errors`, and their stable `codes`. */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
  codes: DomainErrorCode[];
}

type ValidationIssue = { code: DomainErrorCode; message: string };

const toResult = (issues: ValidationIssue[]): ValidationResult => ({
  ok: issues.length === 0,
  errors: issues.map((issue) => issue.message),
  codes: issues.map((issue) => issue.code),
});

/** A project must belong to a client. */
export function validateProjectClient(clientId: ID | undefined | null): ValidationResult {
  return toResult(
    clientId
      ? []
      : [
          {
            code: 'project_client_required',
            message: 'A project must belong to a client.',
          },
        ],
  );
}

/**
 * A scheduled range (allocation / time off) must have both ends present, be
 * well-formed real dates, not be reversed, and stay within the product's finite calendar-span
 * bound. Dates are date-only ISO strings
 * ("YYYY-MM-DD"), which sort lexicographically, so a plain string compare is a
 * correct date compare. This is the single source of truth the store enforces so
 * no caller can persist an empty, malformed, or reversed range (which would
 * otherwise produce NaN / negative bar geometry on the timeline). The malformed
 * check matters most on the import / direct-store paths, which bypass the native
 * date inputs that keep the UI well-formed.
 */
export function validateDateRange(
  startDate?: ISODate | null,
  endDate?: ISODate | null,
): ValidationResult {
  if (!startDate || !endDate) {
    return toResult([{ code: 'date_required', message: 'Start and end dates are required.' }]);
  }
  if (!isValidISODate(startDate) || !isValidISODate(endDate)) {
    return toResult([
      {
        code: 'date_invalid',
        message: 'Dates must be valid calendar dates (YYYY-MM-DD).',
      },
    ]);
  }
  if (endDate < startDate) {
    return toResult([
      {
        code: 'date_reversed',
        message: 'End date cannot be before the start date.',
      },
    ]);
  }
  // Enforce the span bound before callers can allocate one entry per day.
  if (daysInclusive(startDate, endDate) > MAX_SPAN_DAYS) {
    return toResult([
      {
        code: 'date_span_too_long',
        message: `Date span cannot exceed ${MAX_SPAN_DAYS.toLocaleString('en-GB')} calendar days.`,
      },
    ]);
  }
  return toResult([]);
}

/** Resolve the project a booking counts toward. Allocation attribution takes precedence over the
 * activity's project because repeatable activities are project-less and attribute each booking. */
export function effectiveProjectId(
  allocation: Partial<Pick<Allocation, 'projectId'>>,
  activity: Partial<Pick<Activity, 'projectId'>>,
): ID | undefined {
  return allocation.projectId ?? activity.projectId ?? undefined;
}

/** Allocation-level project attribution belongs only to all-projects activities. */
export function allocationAttributionAllowed(kind: unknown): boolean {
  return kind === 'repeatable';
}

type WithoutAllocationAttribution<T> = {
  [Key in keyof T]: Key extends 'projectId'
    ? null
    : Key extends 'updatedAt'
      ? Allocation['updatedAt']
      : T[Key];
};

/**
 * Returns a fresh row with allocation-level attribution removed and, when supplied, restamped.
 * Requires an existing valid allocation attribution and timestamp shape; preserves other fields.
 */
export function withoutAllocationAttribution<T extends Pick<Allocation, 'projectId' | 'updatedAt'>>(
  row: T,
  updatedAt?: Allocation['updatedAt'],
): WithoutAllocationAttribution<T> {
  // The spread preserves each union variant's other fields; only these two fields are replaced.
  return {
    ...row,
    projectId: null,
    updatedAt: updatedAt ?? row.updatedAt,
  } as WithoutAllocationAttribution<T>;
}

/** Check that a project-attributed placeholder allocation matches its bound project.
 * Unattributed work is assignable to any resource; people and externals are unrestricted by this rule. Pure. */
export function validateAllocationAssignment(
  resource: Resource,
  projectId: ID | undefined,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  // Only placeholders are project-restricted. `person` and `external` are intentionally
  // unrestricted (an external 3rd party can be assigned any activity), don't add a guard here.
  if (resource.kind === 'placeholder' && projectId !== undefined) {
    if (!resource.projectId) {
      issues.push({
        code: 'placeholder_project_missing',
        message: 'This placeholder is not bound to a project yet.',
      });
    } else if (resource.projectId !== projectId) {
      issues.push({
        code: 'placeholder_project_mismatch',
        message: 'A placeholder can only be assigned to activities from its bound project.',
      });
    }
  }
  return toResult(issues);
}
