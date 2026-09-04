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
import { acceptedWriteFields } from "./fields";
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
 * `opts` carries writer-context facts (see {@link SanitizeWriteOptions}); omit it entirely for
 * tables the options don't apply to.
 */
export function sanitizeWrite(
  table: string,
  row: Record<string, unknown>,
  existing?: Record<string, unknown>,
  opts: SanitizeWriteOptions = {},
): Record<string, unknown> {
  assertIdPresent(row);
  if (table === "closures" && Object.hasOwn(row, "resourceId")) {
    throw new ValidationError("Company closures cannot reference a resource.");
  }
  const copy = acceptedWriteFields(table, row);
  const nullRequiredFields =
    TABLES[table]?.columns.filter((column) => column.optional !== true && copy[column.name] === null) ?? [];
  if (nullRequiredFields.length > 0) {
    throw new ValidationError(
      `Required field(s) cannot be null: ${nullRequiredFields.map((column) => column.name).join(", ")}.`,
    );
  }
  if (table === "accounts") {
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
    sanitizeAccount(copy, existing?.weekStartsOn === 0 ? 0 : existing?.weekStartsOn === 1 ? 1 : undefined);
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
  if (isScopedEntityKey(table)) {
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
      opts.canSeePrivateNames !== false &&
      !hasUsablePrivateCodeName(copy)
    ) {
      throw new ValidationError("A private client or project requires a code name.");
    }
    const cleaned = sanitizeImportedRecord(table, copy);
    // Lifecycle tombstones (archivedAt/deletedAt, P2.1) are owned ONLY by the four dedicated
    // archive/unarchive/delete/purge routes, which build rows via the pure lifecycle transitions +
    // replaceAccountSlice and NEVER pass through sanitizeWrite. So across every GENERIC write
    // (POST/PUT/PATCH/batch) they are IMMUTABLE in BOTH directions — PIN them to whatever is already
    // stored (`existing`), ignoring the body:
    //   • a crafted body can't SET a tombstone on an active row (which would bypass the
    //     archived-before-delete interlock AND, for resources, the obfuscateResource name scrub,
    //     leaving an un-scrubbed "deleted" row a back-dated deletedAt makes instantly purgeable); and
    //   • an unrelated field-edit (e.g. PATCH {color}) can't CLEAR an existing tombstone — the PATCH
    //     merges `existing` (carrying its real archivedAt) and THEN this funnel runs, so a blind strip
    //     would let upsertRow NULL the column and silently RESURRECT an archived/soft-deleted row to
    //     active. There is NO un-delete route anywhere (the unarchive transition rejects a deleted tombstone),
    //     so this would manufacture a capability the product deliberately has none of.
    // On a CREATE (existing === undefined) both fall through to the strip, so new rows start active.
    // The IMPORT path is untouched: it uses sanitizeImportedRecord directly (not sanitizeWrite), so a
    // legitimate export round-trips its tombstones. (accounts/disciplines carry no tombstones.)
    if (isLifecycleEntityKey(table)) {
      if (typeof existing?.archivedAt === "string") cleaned.archivedAt = existing.archivedAt;
      else delete cleaned.archivedAt;
      if (typeof existing?.deletedAt === "string") cleaned.deletedAt = existing.deletedAt;
      else delete cleaned.deletedAt;
    }
    // Repeat-series membership is assigned only when an allocation is created. Generic PUT/PATCH
    // edits may omit the hidden field (legacy clients) or attempt to change it (crafted requests),
    // but neither can unlink a member, link a one-off or move an occurrence between series.
    if (table === "allocations" && existing) {
      if (typeof existing.seriesId === "string") cleaned.seriesId = existing.seriesId;
      else delete cleaned.seriesId;
    }
    // P1.6 field-confidentiality PINS (note-erasure guard + private-name guard): same PIN mechanism
    // as the tombstones above, but the WHICH-fields-are-gated knowledge is single-sourced in
    // GATED_FIELD_POLICIES (fieldPolicy.ts) so this write-pin can never drift from the read redaction
    // and export-include sites. When the writer's role cannot see a gated field (readSlice redacted
    // it from every row they ever received), their write body is missing that key BY CONSTRUCTION —
    // pin it to the stored value on an UPDATE, strip it on a CREATE. A writer who CAN see the field
    // (owner/admin, or auth OFF) passes through untouched.
    pinGatedFields(table, cleaned, existing, opts);
    return cleaned;
  }
  return copy;
}
