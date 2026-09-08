import { isLifecycleEntityKey } from "@capacitylens/shared/domain/lifecycle";
import { hasUsablePrivateCodeName } from "@capacitylens/shared/domain/privateNames";
import { snapToPresetColor } from "@capacitylens/shared/lib/color";
import { sanitizeAccount, sanitizeImportedRecord } from "@capacitylens/shared/lib/sanitizeImport";
import { cleanText } from "@capacitylens/shared/lib/strings";
import type { ScopedEntityKey } from "@capacitylens/shared/types/entities";
import { isScopedEntityKey, SCHEDULING_MODES } from "@capacitylens/shared/types/entities";
import { pinGatedFields, type SanitizeWriteOptions } from "../fieldPolicy";
import { TABLES } from "../tables";
import { assertIdPresent, ValidationError } from "./errors";
import { buildAcceptedWriteFields } from "./fields";
/** Account calendar/locale facts become immutable after their first valid stored value. */
export const IMMUTABLE_ACCOUNT_FIELDS = ["language", "weekStartsOn", "timezone"] as const;

/** Required domain values the import sanitiser is allowed to invent, but a direct API writer must
 * supply explicitly. Referential fields remain with validateWrite so callers retain its precise
 * domain error codes and messages. */
const DIRECT_WRITE_REQUIRED_FIELDS: Partial<Record<ScopedEntityKey, readonly string[]>> = {
  disciplines: ["name", "sortOrder"],
  resources: ["kind", "role", "employmentType", "workingHoursPerDay", "workingDays", "color"],
  clients: ["name", "color"],
  projects: ["name", "color"],
  phases: ["name"],
  activities: ["name", "kind"],
  allocations: ["hoursPerDay", "status"],
  timeOff: ["resourceId", "type"],
  closures: ["name"],
};

interface SanitizeWriteInput {
  table: string;
  row: Record<string, unknown>;
  existing?: Record<string, unknown> | undefined;
  options?: SanitizeWriteOptions | undefined;
}

function resolveStoredWeekStart(existing: Record<string, unknown> | undefined): 0 | 1 | undefined {
  if (existing?.weekStartsOn === 0) return 0;
  if (existing?.weekStartsOn === 1) return 1;
  return undefined;
}

function sanitizeAccountWrite(
  copy: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const workingDaysRequested = Object.hasOwn(copy, "workingDays");
  // POLICY: a non-preset colour snaps to its NEAREST palette preset (shared/lib/color's
  // snapToPresetColor — the SAME mapper the client uses and the one-time
  // snap-legacy-account-colors migration ran), not a fixed fallback purple. Before this, ANY
  // stored colour outside the (then-current) preset set was replaced with one fixed hex on
  // every write, so a legacy account's colour — or any hex a hand-crafted request supplied —
  // would silently flip to that one colour the next time the row was touched. See DECISIONS.md.
  copy.color = snapToPresetColor(copy.color);
  if (typeof copy.name === "string") copy.name = cleanText(copy.name);
  // schedulingMode is an OPTIONAL enum (absent = 'hourly'). Drop a junk value rather
  // than persisting a mode the scheduler's hourly/days/blocks switch can't handle — the
  // one enum a direct /api/accounts write would otherwise slip past every other guard.
  if (copy.schedulingMode !== undefined && !SCHEDULING_MODES.includes(copy.schedulingMode as never)) {
    delete copy.schedulingMode;
  }
  // The stored week start feeds the empty-workingDays repair: weekStartsOn is immutable and only
  // restored onto the copy AFTER sanitisation (see the loop below), so without this a payload
  // omitting it would repair a Sunday-start account's week to the Monday-start default.
  sanitizeAccount(copy, resolveStoredWeekStart(existing));
  // A full PUT from a pre-v31 client cannot express this field. Preserve the stored selection
  // when it was omitted, while still repairing an explicitly malformed direct write above.
  if (!workingDaysRequested && existing?.workingDays !== undefined) {
    copy.workingDays = existing.workingDays;
  }
  // Frozen account values are write-once, but old/API-created rows may legitimately have no
  // value yet. Preserve an existing value when a PUT omits it or sanitisation drops malformed
  // input; the route-level guard then rejects only a different valid value. This makes malformed
  // input a no-op instead of either a misleading freeze violation or an accidental NULL write.
  if (existing) {
    for (const field of IMMUTABLE_ACCOUNT_FIELDS) {
      if (copy[field] === undefined && existing[field] !== undefined) {
        copy[field] = existing[field];
      }
    }
  }
  return copy;
}

function pinLifecycleFields(
  table: ScopedEntityKey,
  cleaned: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
): void {
  if (!isLifecycleEntityKey(table)) return;
  if (typeof existing?.archivedAt === "string") cleaned.archivedAt = existing.archivedAt;
  else delete cleaned.archivedAt;
  if (typeof existing?.deletedAt === "string") cleaned.deletedAt = existing.deletedAt;
  else delete cleaned.deletedAt;
}

interface SanitizeScopedWriteInput {
  table: ScopedEntityKey;
  copy: Record<string, unknown>;
  existing: Record<string, unknown> | undefined;
  options: SanitizeWriteOptions;
}

function assertScopedWriteFields(
  table: ScopedEntityKey,
  copy: Record<string, unknown>,
  options: SanitizeWriteOptions,
): void {
  const missingRequired = (DIRECT_WRITE_REQUIRED_FIELDS[table] ?? []).filter((field) => !Object.hasOwn(copy, field));
  if (missingRequired.length > 0) {
    throw new ValidationError(`Missing required field(s): ${missingRequired.join(", ")}.`);
  }
  if (table === "closures" && (typeof copy.name !== "string" || cleanText(copy.name).trim().length === 0)) {
    throw new ValidationError("Closure name is required.");
  }
  // Imports repair malformed private rows, but an ordinary owner write must never manufacture a
  // cover name silently. Check before the import sanitiser applies its fail-closed fallback.
  if (
    (table === "clients" || table === "projects") &&
    options.canSeePrivateNames !== false &&
    !hasUsablePrivateCodeName(copy)
  ) {
    throw new ValidationError("A private client or project requires a code name.");
  }
}

function sanitizeScopedWrite({ table, copy, existing, options }: SanitizeScopedWriteInput): Record<string, unknown> {
  assertScopedWriteFields(table, copy, options);
  const cleaned = sanitizeImportedRecord(table, copy);
  // Lifecycle tombstones (archivedAt/deletedAt, P2.1) are owned ONLY by the four dedicated
  // archive/unarchive/delete/purge routes, which build rows via the pure lifecycle transitions and
  // persist them through TenantStore.writeLifecycleRow without passing through sanitizeWrite. So
  // across every GENERIC write
  // (POST/PUT/PATCH/batch) they are IMMUTABLE in BOTH directions — PIN them to whatever is already
  // stored (`existing`), ignoring the body. A crafted body can't SET a tombstone on an active row,
  // and an unrelated edit can't CLEAR one and silently resurrect a row. On CREATE both fields are
  // stripped, so new rows start active. Imports remain untouched because they use
  // sanitizeImportedRecord directly and legitimately round-trip tombstones.
  pinLifecycleFields(table, cleaned, existing);
  // Repeat-series membership is assigned only when an allocation is created. Generic PUT/PATCH
  // edits may omit the hidden field (legacy clients) or attempt to change it (crafted requests),
  // but neither can unlink a member, link a one-off or move an occurrence between series.
  if (table === "allocations" && existing) {
    if (typeof existing.seriesId === "string") cleaned.seriesId = existing.seriesId;
    else delete cleaned.seriesId;
  }
  // Field-confidentiality PINS (note-erasure guard + private-name guard): the fields are
  // single-sourced in GATED_FIELD_POLICIES. A writer who cannot see a gated field has it pinned to
  // the stored value on UPDATE and stripped on CREATE; a writer who can see it passes it through.
  pinGatedFields({ table, cleaned, existing, options });
  return cleaned;
}

/**
 * Repair the constrained value-level fields of a write body, returning a NEW object
 * (the input is not mutated). Scoped tables delegate to the shared
 * sanitizeImportedRecord; accounts (not a scoped table) get their colour repaired
 * here. A well-formed body from the real client is unchanged — this only bites
 * malformed direct API writes.
 *
 * Also rejects any row whose id is not a non-empty string — the single funnel all
 * write paths flow through, so no path can slip past the NULL-id guard.
 *
 * `existing` is the currently-stored row (from getRow) on an UPDATE — PUT/PATCH/batch pass it so
 * the lifecycle tombstones (and, for a note-blind writer, the time-off `note`) can be PINNED to
 * what's on disk (see the scoped branch); it is undefined on a CREATE (POST), which is why a new
 * row always starts with its tombstones stripped (active).
 *
 * `options` carries writer-context facts (see {@link SanitizeWriteOptions}); omit it entirely for
 * tables the options don't apply to.
 */
export function sanitizeWrite({ table, row, existing, options = {} }: SanitizeWriteInput): Record<string, unknown> {
  assertIdPresent(row);
  if (table === "closures" && Object.hasOwn(row, "resourceId")) {
    throw new ValidationError("Company closures cannot reference a resource.");
  }
  const copy = buildAcceptedWriteFields(table, row);
  const nullRequiredFields =
    TABLES[table]?.columns.filter((column) => column.optional !== true && copy[column.name] === null) ?? [];
  if (nullRequiredFields.length > 0) {
    throw new ValidationError(
      `Required field(s) cannot be null: ${nullRequiredFields.map((column) => column.name).join(", ")}.`,
    );
  }
  if (table === "accounts") {
    return sanitizeAccountWrite(copy, existing);
  }
  if (isScopedEntityKey(table)) {
    return sanitizeScopedWrite({ table, copy, existing, options });
  }
  return copy;
}
