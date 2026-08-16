import { NEUTRAL_COLOR, snapToPresetColor } from "./color";
import { INTERNAL_CLIENT_COLOR } from "../data/internalClient";
import { cleanText } from "./strings";
import { parseISOTimestamp } from "./integrity";
import { normalizeCodeName, privateCodeNameFallback } from "../domain/privateNames";
import { defaultAccountWorkingDays, normalizeAccountWorkingDays } from "./accountWorkingDays";
import {
  clampHoursPerDay,
  clampWorkingHoursPerDay,
  externalCapacityDefaults,
  FULL_DAY_HOURS,
  INTERNAL_COLOUR_MODES,
  COMPANY_WIDE_TIME_OFF_FALLBACK,
  isCompanyWideTimeOffType,
  placeholderCapacityDefaults,
  type TimeOffType,
  type Account,
  type AppData,
  type ScopedEntityKey,
  type Weekday,
} from "../types/entities";

// Import is the one write path that bypasses the form validators (a hand-edited or
// corrupt file never went through them). The store already drops allocations/time-off
// with broken ranges or dangling refs; this repairs the *value*-level fields the forms
// would otherwise have guarded — so a negative/NaN hoursPerDay, a junk status enum, or
// a non-hex colour can't land in the store and render as broken geometry.

const VALID_STATUS = ["confirmed", "tentative", "completed"] as const;
const VALID_KIND = ["person", "placeholder", "external"] as const;
const VALID_ACTIVITY_KIND = ["project", "internal", "repeatable"] as const;
const VALID_EMPLOYMENT = ["permanent", "freelancer", "contractor"] as const;
const VALID_ENGAGEMENT = ["studio", "supplementary"] as const;
const VALID_TIMEOFF = ["holiday", "sick", "unpaid", "other"] as const;

const SCOPED_META_FIELDS = ["id", "accountId", "createdAt", "updatedAt"] as const;

/** Exact portable fields accepted for each scoped entity. Import runs in both the in-memory demo
 * and SQLite modes, so project onto the shared domain schema before value repair rather than rely
 * on SQLite's column list to discard undeclared properties later. The type checks below make a
 * domain-field addition fail compilation until this boundary is updated deliberately. */
const IMPORTED_FIELDS = {
  disciplines: [...SCOPED_META_FIELDS, "name", "color", "sortOrder"],
  resources: [
    ...SCOPED_META_FIELDS,
    "kind",
    "name",
    "role",
    "disciplineId",
    "employmentType",
    "engagement",
    "workingHoursPerDay",
    "workingDays",
    "halfDays",
    "projectId",
    "color",
    "isFavourite",
    "archivedAt",
    "deletedAt",
  ],
  clients: [...SCOPED_META_FIELDS, "name", "color", "isPrivate", "codeName", "builtin", "archivedAt", "deletedAt"],
  projects: [...SCOPED_META_FIELDS, "name", "clientId", "color", "isPrivate", "codeName", "archivedAt", "deletedAt"],
  phases: [...SCOPED_META_FIELDS, "name", "projectId"],
  activities: [...SCOPED_META_FIELDS, "name", "kind", "projectId", "phaseId"],
  allocations: [
    ...SCOPED_META_FIELDS,
    "resourceId",
    "activityId",
    "seriesId",
    "startDate",
    "endDate",
    "hoursPerDay",
    "status",
    "note",
    "ignoreWeekends",
  ],
  timeOff: [...SCOPED_META_FIELDS, "resourceId", "startDate", "endDate", "type", "note"],
} as const satisfies {
  [K in ScopedEntityKey]: readonly (keyof AppData[K][number])[];
};

type MissingImportedField = {
  [K in ScopedEntityKey]: Exclude<keyof AppData[K][number], (typeof IMPORTED_FIELDS)[K][number]>;
}[ScopedEntityKey];
const importedFieldsAreComplete: MissingImportedField extends never ? true : never = true;
void importedFieldsAreComplete;

const stripUnknownFields = (key: ScopedEntityKey, rec: Record<string, unknown>): void => {
  const allowed: readonly string[] = IMPORTED_FIELDS[key];
  for (const field of Object.keys(rec)) {
    if (!allowed.includes(field)) delete rec[field];
  }
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

// A RESOURCE's working day must be POSITIVE (a 0-hour working day has no capacity) — route
// it through the SHARED clampWorkingHoursPerDay so import and the store resource path agree
// (a finite value clamps to (0,24]; junk / <= 0 / a non-number falls back to a normal 8h day).
const clampHours = (v: unknown): number => (typeof v === "number" ? clampWorkingHoursPerDay(v) : FULL_DAY_HOURS);

// Allocation hours/day, unlike a resource's working day, may legitimately be 0 (a
// "blocks"-mode booking persists hoursPerDay: 0 — the span counts but the load doesn't).
// Route a finite value through the SHARED clampHoursPerDay so import and the store write
// boundary can never drift (a negative clamps to 0, not the fallback); only a missing /
// non-numeric / NaN value falls back to a normal 8h day.
const clampAllocHours = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? clampHoursPerDay(v) : fallback;

const safeInt = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isSafeInteger(v) ? v : fallback;

// Repair a sloppily-formatted date to the canonical zero-padded "YYYY-MM-DD". The whole
// app relies on dates being zero-padded so they sort chronologically as strings (see
// isWithin), and the forms guarantee that — but a hand-edited import might carry
// "2026-6-1". Pad it so the record is KEPT (the alternative — validateDateRange dropping
// it — silently loses real data). A value that isn't a recognizable Y-M-D is left as-is
// for validateDateRange to reject. Real-calendar validity (e.g. month 13) is still its job.
const normalizeISODate = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim());
  if (!m) return v;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
};

// DE-DUPLICATE: the scheduling math keys weekend-awareness on workingDays.length (a
// length-7 array means "works every calendar day"), so a duplicated set like
// [1,1,1,1,1,1,1] would otherwise reach length 7 and model a Monday-only resource as a
// 7-day worker. Collapse to the distinct sorted weekdays so length reflects real coverage.
// NOTE this deliberately does NOT reuse normalizeAccountWorkingDays: that one REJECTS a whole
// selection containing any junk, while a RESOURCE's week is repaired by FILTERING the junk out and
// keeping whatever real weekdays remain. Only the default they fall back to is shared.
const safeWorkingDays = (v: unknown): Weekday[] => {
  if (!Array.isArray(v)) return defaultAccountWorkingDays();
  const days = v.filter((d): d is Weekday => Number.isInteger(d) && d >= 0 && d <= 6);
  const unique = [...new Set(days)].sort((a, b) => a - b);
  return unique.length ? unique : defaultAccountWorkingDays();
};

/** Repair half days to distinct weekdays that also occur in the resource's working week. */
const safeHalfDays = (v: unknown, workingDays: Weekday[]): Weekday[] => {
  if (!Array.isArray(v)) return [];
  const working = new Set(workingDays);
  return [...new Set(v.filter((d): d is Weekday => Number.isInteger(d) && d >= 0 && d <= 6 && working.has(d)))].sort(
    (a, b) => a - b,
  );
};

// Strip emoji / control / zero-width junk from a free-text field in place (the forms
// reject it; import can't, so it repairs). No-op on a missing/non-string field.
const cleanField = (rec: Record<string, unknown>, field: string, multiline = false): void => {
  if (rec[field] === undefined) return;
  if (typeof rec[field] !== "string") {
    delete rec[field];
    return;
  }
  rec[field] = cleanText(rec[field] as string, { multiline });
};

// Like cleanField, but for a REQUIRED text column (the server schema marks these NOT NULL).
// Cleaning a hand-edited value can collapse it to empty (e.g. an emoji-only name), and a
// missing value is empty too — either would survive in memory (which has no NOT NULL constraint)
// yet be REJECTED by the server, diverging the two import paths. Fall back to a placeholder
// so a required column is never empty and both paths accept the record identically.
const cleanRequiredField = (rec: Record<string, unknown>, field: string, fallback: string): void => {
  const cleaned = typeof rec[field] === "string" ? cleanText(rec[field] as string) : "";
  rec[field] = cleaned.length > 0 ? cleaned : fallback;
};

/** Keep the two optional privacy fields coherent. Public is represented by absence; malformed
 * private imports fail closed to a neutral code name rather than exposing the real name. */
const normalizePrivateNameFields = (rec: Record<string, unknown>): void => {
  if (rec.isPrivate !== true) {
    delete rec.isPrivate;
    delete rec.codeName;
    return;
  }
  const cleaned = typeof rec.codeName === "string" ? normalizeCodeName(cleanText(rec.codeName)) : "";
  rec.codeName = cleaned || privateCodeNameFallback(rec.id);
};

/** Normalize lifecycle tombstones through the state machine's stored invariants. Invalid values
 * become absent; deletion without prior archival, or deletion before archival, is repaired back to
 * the nearest valid non-deleted state. This prevents hidden rows whose timestamps can never satisfy
 * the purge clock. */
const normalizeLifecycleFields = (rec: Record<string, unknown>): void => {
  const timestamp = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (text === "") return null;
    const milliseconds = parseISOTimestamp(text);
    return milliseconds === null ? null : new Date(milliseconds).toISOString();
  };

  const archivedAt = timestamp(rec.archivedAt);
  const deletedAt = timestamp(rec.deletedAt);
  if (archivedAt === null) delete rec.archivedAt;
  else rec.archivedAt = archivedAt;

  if (deletedAt === null || archivedAt === null || deletedAt < archivedAt) delete rec.deletedAt;
  else rec.deletedAt = deletedAt;
};

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
 *   inlineActivityCreateEnabled   absent = true  (inline "Add activity" offered)
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
] as const satisfies readonly AccountBooleanField[];

/** Every boolean-valued optional preference declared on `Account`. */
type AccountBooleanField = {
  [K in keyof Account]-?: boolean extends NonNullable<Account[K]> ? K : never;
}[keyof Account];

// Same compile-completeness guard as IMPORTED_FIELDS above: adding a boolean preference to
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
const ACCOUNT_ENUM_FIELDS: { readonly [K in "language" | "internalColourMode"]: readonly unknown[] } = {
  language: ["en"],
  internalColourMode: INTERNAL_COLOUR_MODES,
};

/** Sanitize the optional calendar fields of an account record in place.
 *  Called by the server write path; the import path doesn't re-import accounts.
 *  `storedWeekStartsOn` is the row's persisted week start, used to repair an empty or malformed
 *  workingDays value when the payload itself omits the (immutable, restored-later) field — without
 *  it a Sunday-start account's repair would silently produce the Monday-start default. */
export function sanitizeAccount(rec: Record<string, unknown>, storedWeekStartsOn?: 0 | 1): Record<string, unknown> {
  if (rec.timezone !== undefined) {
    if (typeof rec.timezone !== "string") {
      delete rec.timezone;
    } else {
      try {
        new Intl.DateTimeFormat(undefined, { timeZone: rec.timezone as string });
      } catch {
        delete rec.timezone;
      }
    }
  }
  if (rec.weekStartsOn !== undefined && rec.weekStartsOn !== 0 && rec.weekStartsOn !== 1) {
    delete rec.weekStartsOn;
  }
  const repairWeekStartsOn = rec.weekStartsOn === 0 || rec.weekStartsOn === 1 ? rec.weekStartsOn : storedWeekStartsOn;
  rec.workingDays = normalizeAccountWorkingDays(rec.workingDays, repairWeekStartsOn === 0 ? 0 : 1);
  // Drop rather than coerce: see ACCOUNT_BOOLEAN_FIELDS / ACCOUNT_ENUM_FIELDS above for the
  // per-field default each absence reads back as.
  for (const field of ACCOUNT_BOOLEAN_FIELDS) {
    if (rec[field] !== undefined && typeof rec[field] !== "boolean") delete rec[field];
  }
  for (const [field, allowed] of Object.entries(ACCOUNT_ENUM_FIELDS)) {
    if (rec[field] !== undefined && !allowed.includes(rec[field])) delete rec[field];
  }
  return rec;
}

/** Project one imported scoped record onto its declared schema, then repair constrained values in
 * place. The record has already had its id remapped + accountId stamped. */
export function sanitizeImportedRecord(key: ScopedEntityKey, rec: Record<string, unknown>): Record<string, unknown> {
  stripUnknownFields(key, rec);
  switch (key) {
    case "resources":
      rec.kind = oneOf(rec.kind, VALID_KIND, "person");
      if (rec.kind === "external") {
        Object.assign(rec, externalCapacityDefaults());
        rec.color = NEUTRAL_COLOR;
        delete rec.disciplineId;
        delete rec.projectId;
      } else {
        rec.employmentType = oneOf(rec.employmentType, VALID_EMPLOYMENT, "permanent");
        rec.engagement = rec.kind === "placeholder" ? "studio" : oneOf(rec.engagement, VALID_ENGAGEMENT, "studio");
        rec.workingHoursPerDay = clampHours(rec.workingHoursPerDay);
        if (rec.kind === "placeholder") {
          Object.assign(rec, placeholderCapacityDefaults());
        } else {
          rec.workingDays = safeWorkingDays(rec.workingDays);
          rec.halfDays = safeHalfDays(rec.halfDays, rec.workingDays as Weekday[]);
        }
        rec.color = snapToPresetColor(rec.color);
        if (rec.kind !== "placeholder") delete rec.projectId;
      }
      if (rec.kind === "placeholder") {
        cleanField(rec, "name");
      } else {
        cleanRequiredField(rec, "name", rec.kind === "external" ? "Unnamed company" : "Unnamed person");
      }
      // Role is optional in both resource forms, but the storage column is NOT NULL. Preserve an
      // intentionally blank (or cleaning-to-blank) string; only synthesize a value when no string
      // was supplied at all.
      if (typeof rec.role === "string") cleanField(rec, "role");
      else rec.role = "Team member";
      // Favourites are an optional binary flag. Preserve explicit true/false; absence is the
      // default-off representation and malformed hand-edited values must not become truthy.
      if (rec.isFavourite !== undefined && typeof rec.isFavourite !== "boolean") delete rec.isFavourite;
      normalizeLifecycleFields(rec);
      break;
    case "allocations":
      rec.status = oneOf(rec.status, VALID_STATUS, "confirmed");
      rec.hoursPerDay = clampAllocHours(rec.hoursPerDay, FULL_DAY_HOURS);
      if (typeof rec.ignoreWeekends !== "boolean") delete rec.ignoreWeekends;
      if (rec.seriesId !== undefined) {
        const seriesId = typeof rec.seriesId === "string" ? cleanText(rec.seriesId) : "";
        if (seriesId) rec.seriesId = seriesId;
        else delete rec.seriesId;
      }
      rec.startDate = normalizeISODate(rec.startDate);
      rec.endDate = normalizeISODate(rec.endDate);
      cleanField(rec, "note", true);
      break;
    case "timeOff":
      rec.type = oneOf(rec.type, VALID_TIMEOFF, "other");
      if (rec.resourceId === null && !isCompanyWideTimeOffType(rec.type as TimeOffType))
        rec.type = COMPANY_WIDE_TIME_OFF_FALLBACK;
      rec.startDate = normalizeISODate(rec.startDate);
      rec.endDate = normalizeISODate(rec.endDate);
      cleanField(rec, "note", true);
      break;
    case "disciplines":
      rec.sortOrder = safeInt(rec.sortOrder, 0);
      if (rec.color === null) delete rec.color;
      else if (rec.color !== undefined) rec.color = snapToPresetColor(rec.color);
      cleanRequiredField(rec, "name", "Untitled"); // name is NOT NULL
      break;
    case "clients":
      rec.color = rec.builtin === true ? INTERNAL_CLIENT_COLOR : snapToPresetColor(rec.color);
      cleanRequiredField(rec, "name", "Untitled"); // name is NOT NULL
      // `builtin` is an OPTIONAL boolean (true only for the Internal pseudo-client). This is
      // DEFENSIVE NORMALISATION for a hand-edited / legacy file: drop anything that isn't strictly
      // `true` so junk (a string, 0, or an explicit `false`) can't persist — its absence reads back
      // as a normal client, and the round-trip omits the column rather than writing a NULL. (The code
      // itself never writes `false`; absent and false mean the same thing.) The import path
      // (remapAndValidateImport) does NOT remove imported builtins — it normalises them to exactly
      // one per account (keeps the FIRST, re-stamping its name/colour, and folds any duplicates into
      // it). This sanitiser still runs per-record there, so a kept builtin's flag survives untouched.
      if (rec.builtin !== true) delete rec.builtin;
      // The built-in Internal bucket is never embargoed. A normal client keeps a coherent optional
      // privacy pair (isPrivate:true + non-empty codeName), defaulting to public when absent/junk.
      if (rec.builtin === true) {
        delete rec.isPrivate;
        delete rec.codeName;
        // Supported mutation paths never allow the protected singleton to enter the lifecycle
        // state machine. Imports repair hand-edited or legacy tombstones back to active.
        delete rec.archivedAt;
        delete rec.deletedAt;
      } else {
        normalizePrivateNameFields(rec);
        normalizeLifecycleFields(rec);
      }
      break;
    case "projects":
      rec.color = snapToPresetColor(rec.color);
      cleanRequiredField(rec, "name", "Untitled"); // name is NOT NULL
      normalizePrivateNameFields(rec);
      normalizeLifecycleFields(rec);
      break;
    case "phases":
      cleanRequiredField(rec, "name", "Untitled"); // name is NOT NULL
      break;
    case "activities":
      cleanRequiredField(rec, "name", "Untitled"); // name is NOT NULL
      // kind is NOT NULL. Default a missing/junk value from the only signal a legacy (pre-kind)
      // record carried: a project-bound activity is 'project', a project-less one is 'repeatable'
      // (the rename of "general"). The referential repair pass then strips any project/phase an
      // internal/repeatable activity carries, keeping kind ⇆ projectId coherent.
      rec.kind = oneOf(rec.kind, VALID_ACTIVITY_KIND, rec.projectId !== undefined ? "project" : "repeatable");
      break;
    default: {
      // Exhaustiveness check: if a new ScopedEntityKey is added to the union without
      // a corresponding case above, this line will fail to compile.
      const _exhaustive: never = key;
      void _exhaustive;
      break;
    }
  }
  return rec;
}
