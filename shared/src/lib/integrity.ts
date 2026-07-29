import { daysInclusive } from "./dateMath";
import { MAX_SPAN_DAYS } from "./schedulingDays";
import type { DomainErrorCode } from "../domain/errors";
import type { AppData, EmploymentType, ID, ISODate, Resource } from "../types/entities";

// Referential-integrity rules and cascade-delete transforms. All pure: cascade helpers return a
// NEW AppData rather than mutating. Callers that own a clock may pass an updatedAt revision for
// surviving rows whose foreign key is cleared, so synchronization observes the relationship edit.

/**
 * Is `s` a well-formed, real calendar date in date-only ISO form ("YYYY-MM-DD")?
 * The shape regex alone would accept `2026-13-40` or `2026-02-30` (lexicographic
 * order is fine, but the date is nonsense and breaks later formatting/geometry),
 * so Gregorian month-length arithmetic validates it without consulting the host timezone.
 */
export function isValidISODate(s: unknown): s is ISODate {
  if (typeof s !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}

const ISO_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Parse the supported ISO timestamp form without accepting implementation-defined Date.parse
 * shorthand or calendar rollover. UTC and explicit numeric offsets are accepted; seconds are
 * required and fractional precision is capped at the millisecond precision the product stores.
 */
export function parseISOTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = ISO_TIMESTAMP_RE.exec(value);
  if (!match) return null;
  const [, date, hourText, minuteText, secondText, fraction, zone, sign, offsetHourText, offsetMinuteText] = match;
  if (!isValidISODate(date)) return null;

  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const milliseconds = Number((fraction ?? "").padEnd(3, "0") || "0");
  if (hour > 23 || minute > 59 || second > 59) return null;

  let offsetMinutes = 0;
  if (zone !== "Z") {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMinutes = (sign === "-" ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  }

  const localAsUtc = Date.parse(
    `${date}T${hourText}:${minuteText}:${secondText}.${String(milliseconds).padStart(3, "0")}Z`,
  );
  const expected = localAsUtc - offsetMinutes * 60_000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed === expected ? parsed : null;
}

export function isTemporary(resource: { employmentType: EmploymentType }): boolean {
  return resource.employmentType !== "permanent";
}

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
            code: "project_client_required",
            message: "A project must belong to a client.",
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
export function validateDateRange(startDate?: ISODate | null, endDate?: ISODate | null): ValidationResult {
  if (!startDate || !endDate)
    return toResult([{ code: "date_required", message: "Start and end dates are required." }]);
  if (!isValidISODate(startDate) || !isValidISODate(endDate)) {
    return toResult([
      {
        code: "date_invalid",
        message: "Dates must be valid calendar dates (YYYY-MM-DD).",
      },
    ]);
  }
  if (endDate < startDate)
    return toResult([
      {
        code: "date_reversed",
        message: "End date cannot be before the start date.",
      },
    ]);
  // O(1), before any caller can materialise one entry per calendar day. This boundary is shared by
  // store writes, server writes and import repair for both allocations and time off.
  if (daysInclusive(startDate, endDate) > MAX_SPAN_DAYS) {
    return toResult([
      {
        code: "date_span_too_long",
        message: `Date span cannot exceed ${MAX_SPAN_DAYS.toLocaleString("en-GB")} calendar days.`,
      },
    ]);
  }
  return toResult([]);
}

/**
 * Placeholder rule: a placeholder is bound to one project and may only take activities
 * from that project — EXCEPT project-less activities (internal/cross-project kinds), which
 * anyone (people and placeholders alike) can be assigned. So the rule only bites when the
 * activity itself belongs to a project.
 */
export function validateAllocationAssignment(resource: Resource, activityProjectId: ID | undefined): ValidationResult {
  const issues: ValidationIssue[] = [];
  // Only PLACEHOLDERS are project-restricted. `person` and `external` are intentionally
  // unrestricted (an external 3rd party can be assigned any activity) — don't add a guard here.
  if (resource.kind === "placeholder" && activityProjectId !== undefined) {
    if (!resource.projectId) {
      issues.push({
        code: "placeholder_project_missing",
        message: "This placeholder is not bound to a project yet.",
      });
    } else if (resource.projectId !== activityProjectId) {
      issues.push({
        code: "placeholder_project_mismatch",
        message: "A placeholder can only be assigned to activities from its bound project.",
      });
    }
  }
  return toResult(issues);
}

// ---- Cascade deletes ----
//
// Every `delete*Cascade` below is PURE: it returns a NEW `AppData` and never mutates its input.
// Pushing onto the undo stack is the store's job. The required revision makes every caller stamp
// surviving FK edits while these transforms express the referential consequences of a delete (which
// children are removed vs. unbound), mirroring the server's ON DELETE CASCADE / SET NULL rules so
// the local and server paths can't diverge. Safe to compose/test in isolation.
//
// These ENTITY cascades are deliberately ID-scoped, not account-scoped. Entity ids are table-global
// identities: SQLite enforces each table's primary key globally, generated ids are UUIDs (the one
// deterministic Internal id incorporates accountId), and import remapping produces fresh global ids.
// Callers still authorize/locate the target in its account before invoking a cascade, but repeating
// the account predicate on every descendant would imply that duplicate same-table ids are supported
// when the persistence and import contracts explicitly forbid them. `deleteAccountCascade` is the
// distinct account-scoped transform: its target is an account id and it intentionally removes every
// scoped row carrying that accountId rather than following one entity identity through foreign keys.

/** Delete a resource and its allocations + time off. PURE — returns a new AppData. */
export function deleteResourceCascade(data: AppData, resourceId: ID): AppData {
  return {
    ...data,
    resources: data.resources.filter((r) => r.id !== resourceId),
    allocations: data.allocations.filter((a) => a.resourceId !== resourceId),
    timeOff: data.timeOff.filter((t) => t.resourceId !== resourceId),
  };
}

/** Delete an activity and its allocations. PURE — returns a new AppData. */
export function deleteActivityCascade(data: AppData, activityId: ID): AppData {
  return {
    ...data,
    activities: data.activities.filter((t) => t.id !== activityId),
    allocations: data.allocations.filter((a) => a.activityId !== activityId),
  };
}

/** Deleting a phase is non-destructive to its activities — it just ungroups them. */
export function deletePhaseCascade(data: AppData, phaseId: ID, updatedAt: string): AppData {
  return {
    ...data,
    phases: data.phases.filter((p) => p.id !== phaseId),
    activities: data.activities.map((t) => (t.phaseId === phaseId ? { ...t, phaseId: undefined, updatedAt } : t)),
  };
}

/** Delete a project: drops its phases + activities + those activities' allocations, unbinds a surviving activity's phase and any placeholder bound to it. PURE — returns a new AppData. */
export function deleteProjectCascade(data: AppData, projectId: ID, updatedAt: string): AppData {
  const removedActivityIds = new Set(data.activities.filter((t) => t.projectId === projectId).map((t) => t.id));
  // Phases removed with the project. Any SURVIVING activity that pointed at one of them
  // (e.g. legacy/incoherent data) must have its phaseId unbound, never left dangling —
  // mirroring the server FK's ON DELETE SET NULL on activities.phaseId.
  const removedPhaseIds = new Set(data.phases.filter((p) => p.projectId === projectId).map((p) => p.id));
  return {
    ...data,
    projects: data.projects.filter((p) => p.id !== projectId),
    phases: data.phases.filter((p) => p.projectId !== projectId),
    activities: data.activities
      .filter((t) => t.projectId !== projectId)
      .map((t) =>
        t.phaseId !== undefined && removedPhaseIds.has(t.phaseId) ? { ...t, phaseId: undefined, updatedAt } : t,
      ),
    allocations: data.allocations.filter((a) => !removedActivityIds.has(a.activityId)),
    // A placeholder bound to this project is unbound (not deleted).
    resources: data.resources.map((r) => (r.projectId === projectId ? { ...r, projectId: undefined, updatedAt } : r)),
  };
}

/** Delete a client and everything beneath it (projects → phases → activities → allocations), unbinding
 *  surviving phases/placeholders as needed. PURE — returns a new AppData. */
export function deleteClientCascade(data: AppData, clientId: ID, updatedAt: string): AppData {
  // Single pass: collect every id removed by this client's deletion FIRST, then filter each
  // table ONCE — rather than re-copying the whole tree per project (deleteProjectCascade × N).
  // Same cascade semantics as looping that helper: drop the client's projects + their phases +
  // their activities (and those activities' allocations), unbind a surviving activity's phaseId that pointed
  // at a removed phase, and unbind a placeholder bound to a removed project.
  const removedProjectIds = new Set(data.projects.filter((p) => p.clientId === clientId).map((p) => p.id));
  const removedPhaseIds = new Set(data.phases.filter((p) => removedProjectIds.has(p.projectId)).map((p) => p.id));
  const removedActivityIds = new Set(
    data.activities.filter((t) => t.projectId !== undefined && removedProjectIds.has(t.projectId)).map((t) => t.id),
  );
  return {
    ...data,
    clients: data.clients.filter((c) => c.id !== clientId),
    projects: data.projects.filter((p) => !removedProjectIds.has(p.id)),
    phases: data.phases.filter((p) => !removedPhaseIds.has(p.id)),
    activities: data.activities
      .filter((t) => !removedActivityIds.has(t.id))
      .map((t) =>
        t.phaseId !== undefined && removedPhaseIds.has(t.phaseId) ? { ...t, phaseId: undefined, updatedAt } : t,
      ),
    allocations: data.allocations.filter((a) => !removedActivityIds.has(a.activityId)),
    resources: data.resources.map((r) =>
      r.projectId !== undefined && removedProjectIds.has(r.projectId) ? { ...r, projectId: undefined, updatedAt } : r,
    ),
  };
}

/** Deleting a discipline ungroups its resources rather than deleting them. */
export function deleteDisciplineCascade(data: AppData, disciplineId: ID, updatedAt: string): AppData {
  return {
    ...data,
    disciplines: data.disciplines.filter((d) => d.id !== disciplineId),
    resources: data.resources.map((r) =>
      r.disciplineId === disciplineId ? { ...r, disciplineId: undefined, updatedAt } : r,
    ),
  };
}
