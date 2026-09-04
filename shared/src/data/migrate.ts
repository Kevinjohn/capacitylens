import { emptyAppData, EXPORT_SCHEMA_VERSION } from "../types/entities";
import { ensureInternalClients } from "./internalClient";
import type { AppData } from "../types/entities";
import { importCandidate, normalize, schemaVersion, UnsupportedSchemaVersionError } from "./migrate/detect";
import { migrateV1toV2, migrateV3toV4, migrateV4toV5, migrateV5toV6 } from "./migrate/steps/v1-v6";
import {
  migrateV6toV7,
  migrateV7toV8,
  migrateV8toV9,
  migrateV9toV10,
  migrateV10toV11,
  migrateV11toV12,
  migrateV12toV13,
  migrateV13toV14,
  migrateV14toV15,
  migrateV15toV16,
} from "./migrate/steps/v6-v18";

export {
  KNOWN_KEYS,
  RECOGNISED_KEYS,
  UnsupportedSchemaVersionError,
  InvalidSchemaVersionError,
  importCandidate,
  looksLikeCapacityLens,
  hasNonArrayKnownTable,
} from "./migrate/detect";

// Turns whatever was persisted (any version, or garbage) into a complete,
// current-shape AppData, plus the IMPORT-path shape guards that decide whether a
// blob is even CapacityLens before we let migrate() near it. This is mostly NORMALIZE-SHAPE
// (coerce every known table to an array via normalize()), not a general version-
// migration engine: there is exactly ONE structural transform (v1 → v2, below). The
// v2 → v3 added `accountId` and needs no separate step here.
// (main.tsx), so older keys are orphaned rather than read, and the import path stamps
// `accountId` on every incoming row (see useStore.importData).

/** One versioned step: run `apply` when the blob predates `version`. */
interface MigrationStep {
  readonly version: number;
  readonly apply: (data: Record<string, unknown>) => Record<string, unknown>;
}

// The ordered step list, split where `repairBase` is captured (immediately before the only step that
// SYNTHESISES a row). Every version marker is listed, no-op steps included: an explicit entry
// documents that the version bump was structural metadata only, rather than an omitted migration.
// There is deliberately no v2→v3 step — that version only added `accountId`, which needs no
// transform here.
const PRE_REPAIR_BASE_STEPS: readonly MigrationStep[] = [
  { version: 2, apply: migrateV1toV2 },
  { version: 4, apply: migrateV3toV4 },
  { version: 5, apply: migrateV4toV5 },
];

const POST_REPAIR_BASE_STEPS: readonly MigrationStep[] = [
  { version: 6, apply: migrateV5toV6 },
  { version: 7, apply: migrateV6toV7 }, // no-op: isPrivate / codeName are structural metadata only
  { version: 8, apply: migrateV7toV8 }, // no-op: Account.internalColourMode
  { version: 9, apply: migrateV8toV9 }, // no-op: per-account schedule view prefs
  { version: 10, apply: migrateV9toV10 }, // no-op: Resource.isFavourite
  { version: 11, apply: migrateV10toV11 },
  { version: 12, apply: migrateV11toV12 },
  { version: 13, apply: migrateV12toV13 }, // no-op: Account.groupResourcesByEngagement
  { version: 14, apply: migrateV13toV14 },
  { version: 15, apply: migrateV14toV15 }, // no-op: repeat-series identity is forward-only
  { version: 16, apply: migrateV15toV16 }, // no-op: TimeOff.resourceId is widened to nullable
  { version: 17, apply: (data) => data }, // structural split: import repair drops invalid legacy rows
  { version: 18, apply: (data) => data }, // optional allocation attribution; import repair owns semantics
];

export interface MigrationWithRepairBase {
  /** Fully migrated and repaired data presented to the application. */
  data: AppData;
  /** Structurally migrated state before Internal-client synthesis/repair, for durable hydration. */
  repairBase: AppData;
}

/**
 * Migrate a value while retaining the pre-Internal-repair state. Server hydration uses this base to
 * persist raw-to-repaired operations before acknowledging the repaired snapshot; ordinary import and
 * local persistence callers should continue to use {@link migrate}.
 */
export function migrateWithRepairBase(raw: unknown): MigrationWithRepairBase {
  if (!raw || typeof raw !== "object") {
    const empty = emptyAppData();
    return { data: empty, repairBase: empty };
  }
  const obj = raw as Record<string, unknown>;
  const version = schemaVersion(obj);
  if (version > EXPORT_SCHEMA_VERSION) throw new UnsupportedSchemaVersionError(version);

  // Accept either a { schemaVersion, data } wrapper or a bare AppData (legacy).
  let data = importCandidate(obj) ?? undefined;

  // The `typeof data === "object"` re-check is deliberate at every step: a migration returns a raw
  // blob, so the guard re-proves the shape rather than trusting the previous step's output.
  const runSteps = (steps: readonly MigrationStep[]) => {
    for (const step of steps) {
      if (data && typeof data === "object" && version < step.version) {
        data = step.apply(data);
      }
    }
  };

  runSteps(PRE_REPAIR_BASE_STEPS);
  // Capture the raw durable state immediately before the only migration which synthesises an
  // Internal client. This also captures current-version bare server slices (which have no schema
  // wrapper and therefore follow the legacy version path) without treating the synthetic row as
  // already acknowledged.
  const repairBase = normalize(data as Partial<AppData> | undefined);
  runSteps(POST_REPAIR_BASE_STEPS);

  return {
    data: ensureInternalClients(normalize(data as Partial<AppData> | undefined), "2026-01-01T00:00:00.000Z"),
    repairBase,
  };
}

export function migrate(raw: unknown): AppData {
  return migrateWithRepairBase(raw).data;
}
