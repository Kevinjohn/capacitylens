import { APP_DATA_KEYS, emptyAppData, EXPORT_SCHEMA_VERSION } from "../../types/entities";
import type { AppData } from "../../types/entities";

// The known portable data tables. APP_DATA_KEYS is the shared structural source of truth.
export const KNOWN_KEYS: readonly string[] = APP_DATA_KEYS;

// Legacy table keys that a pre-rename export/blob may carry. `activities` was once `tasks`
// (the Task→Activity rename, schema v5). The IMPORT shape-guards recognise these so a
// legacy file — even one that ONLY carries the renamed table — is accepted (then migrated),
// not mistaken for non-CapacityLens JSON and rejected. The migrate path renames them (migrateV4toV5).
const LEGACY_KEYS: string[] = ["tasks"];
/** Every table key an incoming blob may legitimately carry — current plus legacy. Exported so the
 * transfer parser counts/validates exactly the same set the shape guards below recognise. */
export const RECOGNISED_KEYS: string[] = [...KNOWN_KEYS, ...LEGACY_KEYS];

/** Refuse data written by a newer app instead of normalizing away fields this build cannot know. */
export class UnsupportedSchemaVersionError extends Error {
  readonly version: number;
  constructor(version: number) {
    super(`Schema version ${version} is newer than this app supports (${EXPORT_SCHEMA_VERSION}).`);
    this.name = "UnsupportedSchemaVersionError";
    this.version = version;
  }
}

/** A present version marker is an integrity boundary, not a hint that can fall back to legacy. */
export class InvalidSchemaVersionError extends Error {
  constructor() {
    super("Schema version must be a non-negative safe integer.");
    this.name = "InvalidSchemaVersionError";
  }
}

export function schemaVersion(obj: Record<string, unknown>): number {
  if (!Object.hasOwn(obj, "schemaVersion")) return 0;
  const value = obj.schemaVersion;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidSchemaVersionError();
  }
  return value;
}

// Unwrap the object the import shape-guards inspect: either the bare AppData map, or
// the `data` field of a { schemaVersion, data } export. Returns null if not a plain object.
export function importCandidate(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (!("data" in obj)) return obj;
  return obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)
    ? (obj.data as Record<string, unknown>)
    : null;
}

// Recognisable-CapacityLens guard for the IMPORT path: any JSON that parses but isn't
// shaped like CapacityLens data would otherwise be migrated to an EMPTY dataset and
// silently wipe the user's data. (The load path stays lenient on purpose.) Lives in
// migrate.ts so the shape guard and the migrate it gates can't drift — mirrors how
// schedule/diary keep their `looksLike…` guard next to migrate().
export function looksLikeCapacityLens(value: unknown): boolean {
  const candidate = importCandidate(value);
  // Accept legacy keys too (e.g. pre-rename `tasks`) so a valid older export — even one
  // whose only array is a renamed table — passes the guard and reaches migrate().
  return !!candidate && RECOGNISED_KEYS.some((k) => Array.isArray(candidate[k]));
}

// A KNOWN table PRESENT but not an array (e.g. `resources: {…}` from a truncated or
// hand-edited export) is structural damage. migrate()'s asArray() would silently coerce
// it to [], and the "imported N" count — computed post-migrate — would report the lost
// table as success. So REJECT it, matching every other load path,
// which routes the same blob to recovery. Principle: repair within a record, reject a
// structurally broken file. (An ABSENT table is fine — migrate fills it empty.)
export function hasNonArrayKnownTable(value: unknown): boolean {
  const candidate = importCandidate(value);
  // Legacy keys count too: a pre-rename `tasks: {…}` (object, not array) is the same
  // structural damage as a current key — reject it rather than coerce it to [] and lose it.
  return !!candidate && RECOGNISED_KEYS.some((k) => k in candidate && !Array.isArray(candidate[k]));
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function normalize(data: Partial<AppData> | undefined): AppData {
  if (!data || typeof data !== "object") return emptyAppData();
  return {
    accounts: asArray(data.accounts),
    disciplines: asArray(data.disciplines),
    resources: asArray(data.resources),
    clients: asArray(data.clients),
    projects: asArray(data.projects),
    phases: asArray(data.phases),
    activities: asArray(data.activities),
    allocations: asArray(data.allocations),
    timeOff: asArray(data.timeOff),
    closures: asArray(data.closures),
  };
}
