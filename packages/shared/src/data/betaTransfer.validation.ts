import { APP_DATA_KEYS, MAX_HOURS_PER_DAY } from "../types/entityKeys.js";
import type { AppData, AppDataKey, Weekday } from "../types/entities.js";
import { INTERNAL_CLIENT_COLOR } from "./internalClient.js";
import { NEUTRAL_COLOR, PRESET_COLORS } from "../lib/color.js";
import { isValidISODate, parseISOTimestamp, validateDateRange } from "../lib/integrity.js";
import {
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  hasDisallowedChars,
  normalizeUserText,
  unicodeCharacterCount,
} from "../lib/strings.js";
import { parseResourceAvatarUrl } from "../domain/resourceAvatarUrl.js";
import { externalCapacityDefaults, placeholderCapacityDefaults } from "../types/entities.js";
import { isRecord } from "../lib/isRecord.js";
import { assert, fail, isId } from "./betaTransfer.errors.js";

/** Declares every portable field for each beta export table. */
export const FIELDS = {
  accounts: [
    "id",
    "createdAt",
    "updatedAt",
    "name",
    "color",
    "schedulingMode",
    "timezone",
    "weekStartsOn",
    "workingDays",
    "language",
    "disciplinesEnabled",
    "placeholdersEnabled",
    "externalEnabled",
    "inlineActivityCreateEnabled",
    "showTaskFieldInSchedule",
    "capacityOverviewAccess",
    "dateStyle",
  ],
  disciplines: ["id", "accountId", "createdAt", "updatedAt", "name", "color", "sortOrder"],
  resources: [
    "id",
    "accountId",
    "createdAt",
    "updatedAt",
    "kind",
    "name",
    "role",
    "avatarUrl",
    "disciplineId",
    "employmentType",
    "engagement",
    "workingHoursPerDay",
    "workingDays",
    "halfDays",
    "projectId",
    "color",
    "isFavourite",
    "firstAvailableDate",
    "lastAvailableDate",
    "archivedAt",
    "deletedAt",
  ],
  clients: [
    "id",
    "accountId",
    "createdAt",
    "updatedAt",
    "name",
    "color",
    "isPrivate",
    "codeName",
    "builtin",
    "archivedAt",
    "deletedAt",
  ],
  projects: [
    "id",
    "accountId",
    "createdAt",
    "updatedAt",
    "name",
    "clientId",
    "color",
    "isPrivate",
    "codeName",
    "archivedAt",
    "deletedAt",
  ],
  phases: ["id", "accountId", "createdAt", "updatedAt", "name", "projectId"],
  activities: [
    "id",
    "accountId",
    "createdAt",
    "updatedAt",
    "name",
    "kind",
    "projectId",
    "phaseId",
    "archivedAt",
    "deletedAt",
  ],
  allocations: [
    "id",
    "accountId",
    "createdAt",
    "updatedAt",
    "resourceId",
    "activityId",
    "projectId",
    "seriesId",
    "startDate",
    "endDate",
    "hoursPerDay",
    "status",
    "note",
    "task",
    "ignoreWeekends",
  ],
  timeOff: ["id", "accountId", "createdAt", "updatedAt", "resourceId", "startDate", "endDate", "type", "note"],
  closures: ["id", "accountId", "createdAt", "updatedAt", "name", "startDate", "endDate"],
} as const satisfies { [K in AppDataKey]: readonly (keyof AppData[K][number])[] };

type MissingPortableField = {
  [K in AppDataKey]: Exclude<keyof AppData[K][number], (typeof FIELDS)[K][number]>;
}[AppDataKey];
const portableFieldsAreComplete: MissingPortableField extends never ? true : never = true;
void portableFieldsAreComplete;

type Row = Record<string, unknown>;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const oneOf = (value: unknown, choices: readonly unknown[]) => choices.includes(value);
const weekdays = [0, 1, 2, 3, 4, 5, 6];
const nullable = (value: unknown, test: (candidate: unknown) => boolean) => value === null || test(value);
const isString = (value: unknown) => typeof value === "string";
const isBoolean = (value: unknown) => typeof value === "boolean";
const isFiniteNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const isTimestamp = (value: unknown) => parseISOTimestamp(value) !== null;
const isCanonicalColor = (value: unknown): value is string =>
  typeof value === "string" && PRESET_COLORS.includes(value as (typeof PRESET_COLORS)[number]);
const isDayList = (value: unknown): value is Weekday[] =>
  Array.isArray(value) &&
  value.every((day: unknown) => typeof day === "number" && weekdays.includes(day)) &&
  new Set(value).size === value.length;

function assertText(
  value: Row,
  field: string,
  path: string,
  options: { allowEmpty?: boolean; multiline?: boolean } = {},
): void {
  const text = value[field];
  assert(typeof text === "string", `${path}.${field}`, "must be a string");
  assert(options.allowEmpty === true || text.trim().length > 0, `${path}.${field}`, "must be a non-empty string");
  assert(
    unicodeCharacterCount(text) <= (options.multiline ? MAX_NOTE_LENGTH : MAX_NAME_LENGTH),
    `${path}.${field}`,
    "is too long",
  );
  const textOptions = options.multiline === undefined ? {} : { multiline: options.multiline };
  assert(!hasDisallowedChars(text, textOptions), `${path}.${field}`, "contains unsupported characters");
  assert(
    text === normalizeUserText(text, textOptions),
    `${path}.${field}`,
    "must already use canonical text spacing and Unicode",
  );
}

function assertNullableText(value: Row, field: string, path: string, options: { multiline?: boolean } = {}): void {
  assert(nullable(value[field], isString), `${path}.${field}`, "must be a string or null");
  if (typeof value[field] === "string") assertText(value, field, path, { allowEmpty: true, ...options });
}

function assertNullableId(value: Row, field: string, path: string): void {
  assert(nullable(value[field], isId), `${path}.${field}`, "must be a bounded id or null");
}

function assertNullableTimestamp(value: Row, field: string, path: string): void {
  assert(nullable(value[field], isTimestamp), `${path}.${field}`, "must be a valid ISO timestamp or null");
}

function assertColor(value: Row, field: string, path: string, systemColor?: string): void {
  assert(
    (systemColor !== undefined && value[field] === systemColor) || isCanonicalColor(value[field]),
    `${path}.${field}`,
    "must be a canonical preset colour",
  );
}

/** Validate every supplied scalar field without coercing or mutating the row. */
export function validateRow(key: AppDataKey, input: unknown, path: string): asserts input is Row {
  assert(isRecord(input), path, "must be an object");
  const row = input;
  for (const field of FIELDS[key] as readonly string[]) {
    assert(own(row, field), `${path}.${field}`, "is required");
  }
  assert(isId(row.id), `${path}.id`, "must be a bounded non-empty id without whitespace");
  assert(isTimestamp(row.createdAt), `${path}.createdAt`, "must be an ISO timestamp");
  assert(isTimestamp(row.updatedAt), `${path}.updatedAt`, "must be an ISO timestamp");
  if (key !== "accounts")
    assert(isId(row.accountId), `${path}.accountId`, "must be a bounded non-empty id without whitespace");
  switch (key) {
    case "accounts":
      assertText(row, "name", path);
      assertColor(row, "color", path);
      assert(
        nullable(row.schedulingMode, (v) => oneOf(v, ["hourly", "days", "blocks"])),
        `${path}.schedulingMode`,
        "is invalid",
      );
      assert(
        nullable(row.timezone, (v) => {
          if (typeof v !== "string") return false;
          try {
            new Intl.DateTimeFormat("en", { timeZone: v });
            return true;
          } catch {
            return false;
          }
        }),
        `${path}.timezone`,
        "must be a valid time zone or null",
      );
      assert(
        nullable(row.weekStartsOn, (v) => v === 0 || v === 1),
        `${path}.weekStartsOn`,
        "must be 0, 1 or null",
      );
      assert(nullable(row.workingDays, isDayList), `${path}.workingDays`, "must be a unique weekday list or null");
      assert(
        row.workingDays === null || (row.workingDays as unknown[]).length > 0,
        `${path}.workingDays`,
        "must contain at least one working day when supplied",
      );
      assert(row.language === null || row.language === "en", `${path}.language`, "must be en or null");
      for (const field of [
        "disciplinesEnabled",
        "placeholdersEnabled",
        "externalEnabled",
        "inlineActivityCreateEnabled",
        "showTaskFieldInSchedule",
      ])
        assert(nullable(row[field], isBoolean), `${path}.${field}`, "must be boolean or null");
      assert(
        nullable(row.capacityOverviewAccess, (v) => oneOf(v, ["owner_admin", "owner_admin_editor", "everyone"])),
        `${path}.capacityOverviewAccess`,
        "is invalid",
      );
      assert(
        nullable(row.dateStyle, (v) => oneOf(v, ["day-month", "day-ordinal-month", "month-day", "month-day-ordinal"])),
        `${path}.dateStyle`,
        "is invalid",
      );
      break;
    case "disciplines":
      assertText(row, "name", path);
      assert(nullable(row.color, isCanonicalColor), `${path}.color`, "must be a preset colour or null");
      assert(Number.isSafeInteger(row.sortOrder), `${path}.sortOrder`, "must be a safe integer");
      break;
    case "resources": {
      assert(oneOf(row.kind, ["person", "placeholder", "external"]), `${path}.kind`, "is invalid");
      assertNullableText(row, "name", path);
      assertText(row, "role", path, { allowEmpty: true });
      assert(nullable(row.avatarUrl, isString), `${path}.avatarUrl`, "must be a string or null");
      assertNullableId(row, "disciplineId", path);
      assert(
        oneOf(row.employmentType, ["permanent", "freelancer", "contractor"]),
        `${path}.employmentType`,
        "is invalid",
      );
      assert(oneOf(row.engagement, ["studio", "supplementary"]), `${path}.engagement`, "is invalid");
      assert(
        isFiniteNumber(row.workingHoursPerDay) &&
          (row.workingHoursPerDay as number) >= 0 &&
          (row.workingHoursPerDay as number) <= 24,
        `${path}.workingHoursPerDay`,
        "must be between 0 and 24",
      );
      assert(
        isDayList(row.workingDays) && isDayList(row.halfDays),
        path,
        "workingDays and halfDays must be unique weekday lists",
      );
      assert(
        row.halfDays.every((day) => (row.workingDays as Weekday[]).includes(day)),
        `${path}.halfDays`,
        "must be a subset of workingDays",
      );
      assertNullableId(row, "projectId", path);
      assertColor(row, "color", path, row.kind === "external" ? NEUTRAL_COLOR : undefined);
      assert(nullable(row.isFavourite, isBoolean), `${path}.isFavourite`, "must be boolean or null");
      for (const field of ["firstAvailableDate", "lastAvailableDate"])
        assert(nullable(row[field], isValidISODate), `${path}.${field}`, "must be a valid date or null");
      assertNullableTimestamp(row, "archivedAt", path);
      assertNullableTimestamp(row, "deletedAt", path);
      if (row.kind === "person" || row.kind === "external") assertText(row, "name", path);
      if (row.kind === "person")
        assert(
          row.workingDays.length > 0 && (row.workingHoursPerDay as number) > 0,
          path,
          "a person must have working days and positive daily capacity",
        );
      if (row.kind !== "placeholder")
        assert(row.projectId === null, `${path}.projectId`, "only a placeholder may be bound to a project");
      if (row.kind !== "person")
        assert(row.avatarUrl === null, `${path}.avatarUrl`, "only a person may have an avatar URL");
      if (row.kind === "person" && row.avatarUrl !== null)
        assert(
          parseResourceAvatarUrl(row.avatarUrl) === row.avatarUrl,
          `${path}.avatarUrl`,
          "must be a canonical credential-free HTTPS URL",
        );
      if (row.kind === "placeholder") {
        const defaults = placeholderCapacityDefaults();
        assert(
          JSON.stringify(row.workingDays) === JSON.stringify(defaults.workingDays) &&
            JSON.stringify(row.halfDays) === JSON.stringify(defaults.halfDays),
          path,
          "placeholder working pattern must use its canonical default",
        );
      }
      if (row.kind === "external") {
        const defaults = externalCapacityDefaults();
        assert(
          row.color === NEUTRAL_COLOR &&
            row.employmentType === defaults.employmentType &&
            row.engagement === defaults.engagement &&
            row.workingHoursPerDay === defaults.workingHoursPerDay &&
            JSON.stringify(row.workingDays) === JSON.stringify(defaults.workingDays) &&
            JSON.stringify(row.halfDays) === JSON.stringify(defaults.halfDays),
          path,
          "external resource must use its canonical capacity defaults",
        );
      }
      break;
    }
    case "clients":
      assertText(row, "name", path);
      assertColor(row, "color", path, row.builtin === true ? INTERNAL_CLIENT_COLOR : undefined);
      assert(nullable(row.isPrivate, isBoolean), `${path}.isPrivate`, "must be boolean or null");
      if (own(row, "codeName")) assertNullableText(row, "codeName", path);
      assert(nullable(row.builtin, isBoolean), `${path}.builtin`, "must be boolean or null");
      assertNullableTimestamp(row, "archivedAt", path);
      assertNullableTimestamp(row, "deletedAt", path);
      if (row.builtin === true)
        assert(
          (row.isPrivate === null || row.isPrivate === false) && row.codeName === null,
          path,
          "Internal must remain public and have no code name",
        );
      break;
    case "projects":
      assertText(row, "name", path);
      assert(isId(row.clientId), `${path}.clientId`, "must be a bounded id");
      assertColor(row, "color", path);
      assert(nullable(row.isPrivate, isBoolean), `${path}.isPrivate`, "must be boolean or null");
      if (own(row, "codeName")) assertNullableText(row, "codeName", path);
      assertNullableTimestamp(row, "archivedAt", path);
      assertNullableTimestamp(row, "deletedAt", path);
      break;
    case "phases":
      assertText(row, "name", path);
      assert(isId(row.projectId), `${path}.projectId`, "must be a bounded id");
      break;
    case "activities":
      assertText(row, "name", path);
      assert(oneOf(row.kind, ["project", "internal", "repeatable"]), `${path}.kind`, "is invalid");
      assertNullableId(row, "projectId", path);
      assertNullableId(row, "phaseId", path);
      assertNullableTimestamp(row, "archivedAt", path);
      assertNullableTimestamp(row, "deletedAt", path);
      assert(
        row.kind === "project" ? row.projectId !== null : row.projectId === null && row.phaseId === null,
        path,
        "activity kind and project/phase references do not agree",
      );
      break;
    case "allocations":
      for (const field of ["resourceId", "activityId"])
        assert(isId(row[field]), `${path}.${field}`, "must be a bounded id");
      assertNullableId(row, "projectId", path);
      assertNullableId(row, "seriesId", path);
      assert(
        validateDateRange(row.startDate as never, row.endDate as never).ok,
        path,
        "allocation date range is invalid",
      );
      assert(
        isFiniteNumber(row.hoursPerDay) &&
          (row.hoursPerDay as number) >= 0 &&
          (row.hoursPerDay as number) <= MAX_HOURS_PER_DAY,
        `${path}.hoursPerDay`,
        "is outside the supported range",
      );
      assert(oneOf(row.status, ["confirmed", "tentative", "completed"]), `${path}.status`, "is invalid");
      assertNullableText(row, "note", path, { multiline: true });
      assertNullableText(row, "task", path);
      assert(nullable(row.ignoreWeekends, isBoolean), `${path}.ignoreWeekends`, "must be boolean or null");
      break;
    case "timeOff":
      assert(isId(row.resourceId), `${path}.resourceId`, "must be a bounded id");
      assert(
        validateDateRange(row.startDate as never, row.endDate as never).ok,
        path,
        "time-off date range is invalid",
      );
      assert(oneOf(row.type, ["holiday", "sick", "unpaid", "other"]), `${path}.type`, "is invalid");
      assertNullableText(row, "note", path, { multiline: true });
      break;
    case "closures":
      assertText(row, "name", path);
      assert(validateDateRange(row.startDate as never, row.endDate as never).ok, path, "closure date range is invalid");
      break;
  }
}

/** Copy only the named portable fields for one already scoped account. */
export function projectBetaData(data: AppData, accountId: string): AppData {
  const projected = {} as AppData;
  for (const key of APP_DATA_KEYS) {
    const source = data[key] as unknown[];
    if (!Array.isArray(source)) fail(`data.${key}`, "must be a list");
    const selected =
      key === "accounts"
        ? source.filter((row) => isRecord(row) && row.id === accountId)
        : source.filter((row) => isRecord(row) && row.accountId === accountId);
    (projected as unknown as Record<string, unknown>)[key] = selected.map((input) => {
      if (!isRecord(input)) fail(`data.${key}`, "contains a non-object row");
      const copy: Row = {};
      for (const field of FIELDS[key] as readonly string[])
        if (own(input, field)) {
          const fieldValue = input[field];
          copy[field] = Array.isArray(fieldValue) ? (fieldValue as unknown[]).map((item: unknown) => item) : fieldValue;
        }
      return copy;
    });
  }
  return projected;
}
