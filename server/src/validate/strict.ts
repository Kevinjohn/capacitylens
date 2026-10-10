import { INTERNAL_CLIENT_COLOR } from "@capacitylens/shared/data/internalClient";
import { isWeekdaySet } from "@capacitylens/shared/lib/accountWorkingDays";
import { isPresetColor, NEUTRAL_COLOR } from "@capacitylens/shared/lib/color";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import {
  hasDisallowedChars,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  normalizeUserText,
  unicodeCharacterCount,
} from "@capacitylens/shared/lib/strings";
import {
  CAPACITY_OVERVIEW_ACCESS_VALUES,
  DATE_STYLES,
  SCHEDULING_MODES,
  externalCapacityDefaults,
  placeholderCapacityDefaults,
} from "@capacitylens/shared/types/entities";
import { parseResourceAvatarUrl } from "@capacitylens/shared/domain/resourceAvatarUrl";
import { TABLES } from "../tables";
import type { SanitizeWriteOptions } from "../fieldPolicy";
import { ValidationError } from "./errors";

const VALID_KIND = ["person", "placeholder", "external"] as const;
const VALID_ACTIVITY_KIND = ["project", "internal", "repeatable"] as const;
const VALID_EMPLOYMENT = ["permanent", "freelancer", "contractor"] as const;
const VALID_ENGAGEMENT = ["studio", "supplementary"] as const;
const VALID_STATUS = ["confirmed", "tentative", "completed"] as const;
const VALID_TIMEOFF = ["holiday", "sick", "unpaid", "other"] as const;

const CHOICES: Readonly<Record<string, readonly unknown[]>> = {
  schedulingMode: SCHEDULING_MODES,
  capacityOverviewAccess: CAPACITY_OVERVIEW_ACCESS_VALUES,
  dateStyle: DATE_STYLES,
  language: ["en"],
  kind: VALID_KIND,
  employmentType: VALID_EMPLOYMENT,
  engagement: VALID_ENGAGEMENT,
  status: VALID_STATUS,
  type: VALID_TIMEOFF,
};
const BOOLEAN_FIELDS = new Set([
  "disciplinesEnabled",
  "placeholdersEnabled",
  "externalEnabled",
  "inlineActivityCreateEnabled",
  "showTaskFieldInSchedule",
  "isPrivate",
  "builtin",
  "isFavourite",
  "ignoreWeekends",
]);
const DATE_FIELDS = new Set(["startDate", "endDate", "firstAvailableDate", "lastAvailableDate"]);
const TEXT_FIELDS = new Set(["name", "role", "codeName", "task", "note"]);
const NUMBER_FIELDS = new Set(["hoursPerDay", "workingHoursPerDay", "sortOrder"]);
const CLEARABLE_FIELDS = new Set(["avatarUrl", "firstAvailableDate", "lastAvailableDate"]);
const MAX_IDENTIFIER_UNITS = 256;

function reject(field: string, reason: string): never {
  throw new ValidationError(`${field} ${reason}.`);
}

function assertText(field: string, value: unknown): void {
  if (typeof value !== "string") reject(field, "must be text");
  const canonical = value.normalize("NFC");
  const multiline = field === "note";
  const normalized = normalizeUserText(canonical, { multiline });
  if (hasDisallowedChars(canonical, { multiline })) reject(field, "contains unsupported characters");
  if (unicodeCharacterCount(normalized) > (multiline ? MAX_NOTE_LENGTH : MAX_NAME_LENGTH)) reject(field, "is too long");
  if (field === "name" && normalized.length === 0) reject(field, "is required");
}

type WriteField = { table: string; field: string; value: unknown; row: Record<string, unknown> };

// eslint-disable-next-line complexity, max-lines-per-function -- table, field and value choices share one rejection funnel.
function assertField({ table, field, value, row }: WriteField): void {
  if (value === null) {
    if (CLEARABLE_FIELDS.has(field)) return;
    reject(field, "cannot be null");
  }
  if (value === undefined) reject(field, "cannot be undefined");
  if (TEXT_FIELDS.has(field)) return assertText(field, value);
  if (field === "kind" && table === "activities") {
    if (!VALID_ACTIVITY_KIND.includes(value as never)) reject(field, "is not supported");
    return;
  }
  if (CHOICES[field]) {
    if (!CHOICES[field].includes(value)) reject(field, "is not supported");
    return;
  }
  if (BOOLEAN_FIELDS.has(field)) {
    if (typeof value !== "boolean") reject(field, "must be a boolean");
    return;
  }
  if (NUMBER_FIELDS.has(field)) {
    if (typeof value !== "number" || !Number.isFinite(value)) reject(field, "must be a finite number");
    if (field === "sortOrder" && !Number.isSafeInteger(value)) reject(field, "must be a safe integer");
    if (field === "hoursPerDay" && (value < 0 || value > 24)) reject(field, "must be between 0 and 24");
    if (field === "workingHoursPerDay" && (value <= 0 || value > 24))
      reject(field, "must be greater than 0 and at most 24");
    return;
  }
  if (DATE_FIELDS.has(field)) {
    if (!isValidISODate(value)) reject(field, "must be a valid calendar date (YYYY-MM-DD)");
    return;
  }
  if (field === "workingDays" || field === "halfDays") {
    if (!isWeekdaySet(value)) reject(field, "must contain distinct weekdays from 0 to 6");
    if (field === "workingDays" && value.length === 0) reject(field, "must contain a working day");
    return;
  }
  if (field === "weekStartsOn") {
    if (value !== 0 && value !== 1) reject(field, "must be Sunday or Monday");
    return;
  }
  if (field === "timezone") {
    if (typeof value !== "string" || value.length > 128) reject(field, "must be a supported time zone");
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: value });
    } catch {
      reject(field, "must be a supported time zone");
    }
    return;
  }
  if (field === "color") {
    if (
      !isPresetColor(value) &&
      !(table === "resources" && row.kind === "external" && value === NEUTRAL_COLOR) &&
      !(table === "clients" && row.builtin === true && value === INTERNAL_CLIENT_COLOR)
    )
      reject(field, "must be a preset colour");
    return;
  }
  if (field === "avatarUrl") {
    if (parseResourceAvatarUrl(value) == null) reject(field, "must be an HTTPS URL without credentials");
    return;
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_UNITS ||
    /[\p{C}\s]/u.test(value)
  )
    reject(field, "must be a bounded identifier");
}

// eslint-disable-next-line complexity -- kind-specific defaults are checked at one write boundary.
function assertInertResourceFields(requested: Record<string, unknown>, candidate: Record<string, unknown>): void {
  if (candidate.kind === "person") {
    if (Object.hasOwn(requested, "projectId")) reject("projectId", "is only used by placeholders");
    return;
  }
  if (candidate.kind !== "placeholder" && candidate.kind !== "external") return;
  const defaults = candidate.kind === "external" ? externalCapacityDefaults() : placeholderCapacityDefaults();
  for (const field of ["workingDays", "halfDays"] as const) {
    if (Object.hasOwn(requested, field) && JSON.stringify(candidate[field]) !== JSON.stringify(defaults[field]))
      reject(field, "must match this resource kind's defaults");
  }
  if (candidate.kind === "placeholder") {
    if (Object.hasOwn(requested, "engagement") && candidate.engagement !== "studio")
      reject("engagement", "must be studio for a placeholder");
  } else {
    const externalDefaults = externalCapacityDefaults();
    for (const field of ["employmentType", "engagement", "workingHoursPerDay"] as const) {
      if (Object.hasOwn(requested, field) && candidate[field] !== externalDefaults[field])
        reject(field, "must match an external resource's defaults");
    }
    if (Object.hasOwn(requested, "color") && candidate.color !== NEUTRAL_COLOR)
      reject("color", "must be the external resource colour");
    if (Object.hasOwn(requested, "disciplineId") || Object.hasOwn(requested, "projectId"))
      reject("disciplineId", "is not used by external resources");
  }
  for (const field of ["firstAvailableDate", "lastAvailableDate", "avatarUrl"] as const) {
    if (Object.hasOwn(requested, field)) reject(field, "is only used by people");
  }
}

type StrictWriteInput = {
  table: string;
  requested: Record<string, unknown>;
  candidate: Record<string, unknown>;
  existing: Record<string, unknown> | undefined;
  options: SanitizeWriteOptions;
};

/** Reject malformed supplied ordinary-write fields before import-only repair can change them. */
// eslint-disable-next-line complexity -- optional metadata echoes and resource cross-field checks are independent.
export function assertStrictWriteFields({ table, requested, candidate, existing, options }: StrictWriteInput): void {
  const spec = TABLES[table];
  if (!spec) throw new ValidationError("Unknown table.");
  const accepted = new Set(spec.columns.map((column) => column.name));
  for (const [field, value] of Object.entries(requested)) {
    if (!accepted.has(field)) reject(field, "is not writable");
    // A blind writer cannot echo the original hidden value; the later field policy pins it.
    if (table === "timeOff" && field === "note" && options.canSeeTimeOffNote === false) continue;
    if (
      (table === "clients" || table === "projects") &&
      options.canSeePrivateNames === false &&
      (field === "isPrivate" || field === "codeName" || (field === "name" && existing?.isPrivate === true))
    )
      continue;
    // A full-row client may echo a historical revision value it cannot repair.
    if ((field === "createdAt" || field === "updatedAt") && existing && value === existing[field]) continue;
    assertField({ table, field, value, row: candidate });
  }
  if (table === "resources") assertInertResourceFields(requested, candidate);
  if (table === "resources" && candidate.kind === "person") {
    const first = candidate.firstAvailableDate;
    const last = candidate.lastAvailableDate;
    if (
      (Object.hasOwn(requested, "firstAvailableDate") || Object.hasOwn(requested, "lastAvailableDate")) &&
      typeof first === "string" &&
      typeof last === "string" &&
      first > last
    )
      reject("firstAvailableDate", "cannot be after lastAvailableDate");
    const days = candidate.workingDays;
    const halfDays = candidate.halfDays;
    if (
      (Object.hasOwn(requested, "workingDays") || Object.hasOwn(requested, "halfDays")) &&
      Array.isArray(days) &&
      Array.isArray(halfDays) &&
      halfDays.some((day) => !days.includes(day))
    )
      reject("halfDays", "must be included in workingDays");
  }
}
