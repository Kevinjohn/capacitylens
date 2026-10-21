import { importCandidate, RECOGNISED_KEYS, migrate, looksLikeCapacityLens, hasNonArrayKnownTable } from "./migrate.js";
import { APP_DATA_KEYS, EXPORT_SCHEMA_VERSION } from "../types/entities.js";
import type { AppData, PersistedState } from "../types/entities.js";

// Import validates the file structure before migration; callers repair field values through the import remapper.

/** Serialize data as a versioned, pretty-printed export document. Pure. */
export function serializeData(data: AppData): string {
  const state: PersistedState = { schemaVersion: EXPORT_SCHEMA_VERSION, data, revision: null };
  return JSON.stringify(state, null, 2);
}

function parseJson(json: string): unknown {
  return JSON.parse(json) as unknown;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Parse, structurally validate and migrate an export document. Field values are not sanitised here:
 * callers must still pass the result through the import remapper before storing it. Throws a
 * display-safe `Error` on unreadable, unrecognised, damaged or oversized input.
 */
export function parseData(json: string): AppData {
  let raw: unknown;
  try {
    raw = parseJson(json);
  } catch (e) {
    // Preserve the parser failure as the cause while returning a display-safe import error.
    throw new Error("That file isn't valid JSON.", { cause: e });
  }
  // Reject a structurally damaged file (a known table present but not a list) rather than
  // letting migrate() silently coerce it to [] and under-report the loss. This must run before
  // the recognisable-shape guard: a file whose only known table is damaged has no array with which
  // to satisfy looksLikeCapacityLens(), but it is still recognisably damaged CapacityLens data.
  const candidate = importCandidate(raw);
  if (hasNonArrayKnownTable(raw)) {
    throw new Error("This file is damaged: a data table is not a list. Nothing was imported.");
  }
  if (candidate === null || !looksLikeCapacityLens(raw)) {
    throw new Error("This file is not CapacityLens data.");
  }
  // parseData's public return type is AppData, so every present table element must at least be a
  // record before migrations/repairs may inspect it. Field-level sanitisation remains the import
  // remapper's job; this guard prevents null/primitives from escaping as typed rows or triggering
  // native property-access errors inside migration helpers.
  for (const key of RECOGNISED_KEYS) {
    const rows = candidate[key];
    if (!isUnknownArray(rows)) continue;
    if (rows.some((row) => row === null || typeof row !== "object" || Array.isArray(row))) {
      throw new Error(`This file is damaged: the ${key} table contains an invalid record. Nothing was imported.`);
    }
  }
  const data = migrate(raw);
  // A CapacityLens-shaped file that migrates to zero records would, if imported, replace the
  // active company's slice with nothing, a silent wipe. Refuse it: importing an empty
  // file is never the intent (delete is the explicit path for clearing data).
  if (APP_DATA_KEYS.every((key) => data[key].length === 0)) {
    throw new Error("This file contains no CapacityLens records.");
  }
  return data;
}
