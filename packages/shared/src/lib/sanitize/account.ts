import { normalizeAccountWorkingDays } from "../accountWorkingDays.js";
import { CAPACITY_OVERVIEW_ACCESS_VALUES, DATE_STYLES, SCHEDULING_MODES } from "../../types/entities.js";
import type { Account } from "../../types/entities.js";

// Drop malformed boolean preferences so each reader uses its declared default instead of coercing strings such as "no" to true.
const ACCOUNT_BOOLEAN_FIELDS = [
  "disciplinesEnabled",
  "placeholdersEnabled",
  "externalEnabled",
  "inlineActivityCreateEnabled",
  "showTaskFieldInSchedule",
] as const satisfies readonly AccountBooleanField[];

type AccountBooleanField = {
  [K in keyof Account]-?: boolean extends NonNullable<Account[K]> ? K : never;
}[keyof Account];

// Same compile-completeness guard as IMPORTED_FIELDS in importedFields.ts: adding a boolean preference to
// `Account` without listing it here fails the build rather than silently letting junk persist.
type MissingAccountBooleanField = Exclude<AccountBooleanField, (typeof ACCOUNT_BOOLEAN_FIELDS)[number]>;
const accountBooleanFieldsAreComplete: MissingAccountBooleanField extends never ? true : never = true;
void accountBooleanFieldsAreComplete;

// Require allowed-value lists for finite-string fields; include `language` explicitly because its type is `string`.
type AccountEnumField =
  | "language"
  | {
      [K in keyof Account]-?: NonNullable<Account[K]> extends string
        ? string extends NonNullable<Account[K]>
          ? never
          : K
        : never;
    }[keyof Account];

const ACCOUNT_ENUM_FIELDS: { readonly [K in AccountEnumField]: readonly unknown[] } = {
  language: ["en"],
  schedulingMode: SCHEDULING_MODES,
  capacityOverviewAccess: CAPACITY_OVERVIEW_ACCESS_VALUES,
  dateStyle: DATE_STYLES,
};

/** Sanitize the optional calendar fields of an account record in place.
 * Called by the server write path; the import path doesn't re-import accounts. Retired account
 * preferences are not listed above: the server's write-column whitelist drops them before this runs.
 * `storedWeekStartsOn` is the row's persisted week start, used to repair an empty or malformed
 * workingDays value when the payload itself omits the (immutable, restored-later) field, without
 * it a Sunday-start account's repair would silently produce the Monday-start default. */
export function sanitizeAccount(record: Record<string, unknown>, storedWeekStartsOn?: 0 | 1): Record<string, unknown> {
  sanitizeTimezone(record);
  const repairWeekStartsOn = sanitizeWeekStartsOn(record, storedWeekStartsOn);
  record.workingDays = normalizeAccountWorkingDays(record.workingDays, repairWeekStartsOn === 0 ? 0 : 1);
  // Remove invalid values; readers apply defaults when optional fields are absent.
  sanitizeOptionalPreferences(record);
  return record;
}

function sanitizeWeekStartsOn(record: Record<string, unknown>, storedWeekStartsOn?: 0 | 1): 0 | 1 | undefined {
  if (record.weekStartsOn === 0 || record.weekStartsOn === 1) return record.weekStartsOn;
  if (record.weekStartsOn !== undefined) delete record.weekStartsOn;
  return storedWeekStartsOn;
}

function sanitizeOptionalPreferences(record: Record<string, unknown>): void {
  for (const field of ACCOUNT_BOOLEAN_FIELDS) {
    if (record[field] !== undefined && typeof record[field] !== "boolean") delete record[field];
  }
  for (const [field, allowed] of Object.entries(ACCOUNT_ENUM_FIELDS)) {
    if (record[field] !== undefined && !allowed.includes(record[field])) delete record[field];
  }
}

function sanitizeTimezone(record: Record<string, unknown>): void {
  if (record.timezone === undefined) return;
  if (typeof record.timezone !== "string") {
    delete record.timezone;
    return;
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: record.timezone });
  } catch {
    // Invalid time zones are removed so the account can use its default.
    delete record.timezone;
  }
}
