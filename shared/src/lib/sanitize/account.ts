import { normalizeAccountWorkingDays } from "../accountWorkingDays";
import { CAPACITY_OVERVIEW_ACCESS_VALUES, INTERNAL_COLOUR_MODES, type Account } from "../../types/entities";

/**
 * Every optional BOOLEAN preference on an account. Each is dropped rather than persisted when a
 * hand-edited value isn't a real boolean, so its ABSENCE reads back as the documented default on
 * the client — which differs per field and is what `Account` documents:
 *   disciplinesEnabled            absent = true  (disciplines shown)
 *   groupResourcesByEngagement    absent = true  (Studio / Supplementary partitioning on)
 *   placeholdersEnabled           absent = false (placeholders hidden out of the box)
 *   externalEnabled               absent = false (external resources hidden out of the box)
 *   showInternalProjects          absent = true  (Internal-client bars shown)
 *   showInternalActivities        absent = true  (internal-kind bars shown)
 *   inlineActivityCreateEnabled   absent = false (inline "Add activity" hidden)
 *   showTaskFieldInSchedule       absent = false (allocation task hidden)
 * Dropping junk — rather than coercing it — is what keeps a `false`-defaulting flag from turning on
 * because someone typed "no" into the file.
 */
const ACCOUNT_BOOLEAN_FIELDS = [
  "disciplinesEnabled",
  "groupResourcesByEngagement",
  "placeholdersEnabled",
  "externalEnabled",
  "showInternalProjects",
  "showInternalActivities",
  "inlineActivityCreateEnabled",
  "showTaskFieldInSchedule",
] as const satisfies readonly AccountBooleanField[];

/** Every boolean-valued optional preference declared on `Account`. */
type AccountBooleanField = {
  [K in keyof Account]-?: boolean extends NonNullable<Account[K]> ? K : never;
}[keyof Account];

// Same compile-completeness guard as IMPORTED_FIELDS in importedFields.ts: adding a boolean preference to
// `Account` without listing it here fails the build rather than silently letting junk persist.
type MissingAccountBooleanField = Exclude<AccountBooleanField, (typeof ACCOUNT_BOOLEAN_FIELDS)[number]>;
const accountBooleanFieldsAreComplete: MissingAccountBooleanField extends never ? true : never = true;
void accountBooleanFieldsAreComplete;

/**
 * Optional account fields constrained to a fixed value set. Anything outside it is dropped:
 *   language            English-only until P1.5.1 (Paraglide); a hand-edited 'fr'/123/etc. must not
 *                       persist — its absence reads back as 'en'.
 *   internalColourMode  an unknown mode's absence deliberately reads as the safe/default grey.
 */
const ACCOUNT_ENUM_FIELDS: {
  readonly [K in "language" | "internalColourMode" | "capacityOverviewAccess"]: readonly unknown[];
} = {
  language: ["en"],
  internalColourMode: INTERNAL_COLOUR_MODES,
  capacityOverviewAccess: CAPACITY_OVERVIEW_ACCESS_VALUES,
};

/** Sanitize the optional calendar fields of an account record in place.
 *  Called by the server write path; the import path doesn't re-import accounts.
 *  `storedWeekStartsOn` is the row's persisted week start, used to repair an empty or malformed
 *  workingDays value when the payload itself omits the (immutable, restored-later) field — without
 *  it a Sunday-start account's repair would silently produce the Monday-start default. */
export function sanitizeAccount(record: Record<string, unknown>, storedWeekStartsOn?: 0 | 1): Record<string, unknown> {
  sanitizeTimezone(record);
  const repairWeekStartsOn = sanitizeWeekStartsOn(record, storedWeekStartsOn);
  record.workingDays = normalizeAccountWorkingDays(record.workingDays, repairWeekStartsOn === 0 ? 0 : 1);
  // Drop rather than coerce: see ACCOUNT_BOOLEAN_FIELDS / ACCOUNT_ENUM_FIELDS above for the
  // per-field default each absence reads back as.
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
    delete record.timezone;
  }
}
