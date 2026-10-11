import { emptyAppData, EXPORT_SCHEMA_VERSION } from "../types/entities";
import { applyInternalClientRepairs } from "./internalClient";
import type { AppData } from "../types/entities";
import { importCandidate, normalize, parseSchemaVersion, UnsupportedSchemaVersionError } from "./migrate/detect";
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
// current-shape AppData, plus the import-path shape guards that decide whether a
// blob is even CapacityLens before we let migrate() near it. This is mostly normalize-shape
// (coerce every known table to an array via normalize()), not a general version-
// migration engine: there is exactly one structural transform (v1 → v2, below). The
// v2 → v3 added `accountId` and needs no separate step here.
// (main.tsx), so older keys are orphaned rather than read, and the import path stamps
// `accountId` on every incoming row (see useStore.importData).

/** One versioned step: run `apply` when the blob predates `version`. */
interface MigrationStep {
  readonly version: number;
  readonly apply: (data: Record<string, unknown>) => Record<string, unknown>;
}

// The ordered step list, split where `repairBase` is captured (immediately before the only step that
// synthesises a row). Every version marker is listed, no-op steps included: an explicit entry
// documents that the version bump was structural metadata only, rather than an omitted migration.
// There is deliberately no v2→v3 step. That version only added `accountId`, which needs no
// transform here.
const PRE_REPAIR_BASE_STEPS: readonly MigrationStep[] = [
  { version: 2, apply: migrateV1toV2 },
  { version: 4, apply: migrateV3toV4 },
  { version: 5, apply: migrateV4toV5 },
];

const POST_REPAIR_BASE_STEPS: readonly MigrationStep[] = [
  { version: 6, apply: migrateV5toV6 },
  // Private-client metadata needs no transform because sanitization preserves its shape.
  { version: 7, apply: migrateV6toV7 },
  // Account internal colour mode remains structural metadata.
  { version: 8, apply: migrateV7toV8 },
  // Schedule view preferences remain account metadata and need no data transform.
  { version: 9, apply: migrateV8toV9 },
  // Favourite state remains a direct resource field.
  { version: 10, apply: migrateV9toV10 },
  { version: 11, apply: migrateV10toV11 },
  { version: 12, apply: migrateV11toV12 },
  // Resource grouping preference remains structural account metadata.
  { version: 13, apply: migrateV12toV13 },
  { version: 14, apply: migrateV13toV14 },
  // Repeat-series identity is forward-only and requires no legacy transform.
  { version: 15, apply: migrateV14toV15 },
  // Nullable time-off resource IDs are preserved by the current shape.
  { version: 16, apply: migrateV15toV16 },
  // Invalid legacy rows are removed by import repair, not this version step.
  { version: 17, apply: (data) => data },
  // Optional allocation attribution is interpreted by import repair.
  { version: 18, apply: (data) => data },
  // Optional activity lifecycle state is interpreted by import repair.
  { version: 19, apply: (data) => data },
  // Optional task text and account visibility preferences need no shape transform.
  { version: 20, apply: (data) => data },
  // Optional resource availability and capacity access are repaired during import.
  { version: 21, apply: (data) => data },
  // Date style remains optional and sanitization owns its value.
  { version: 22, apply: (data) => data },
  // Avatar URLs remain optional and sanitization owns their value.
  { version: 23, apply: (data) => data },
];

// Guards against a migration step being added without bumping EXPORT_SCHEMA_VERSION to match (or
// vice versa): the last POST_REPAIR_BASE_STEPS version is the ceiling migrate() can bring data up to.
// This is a development-time mistake, not a runtime condition, but it must never throw merely from
// importing this module (shared/data/migrate is on the app's entry graph, before any error boundary
// exists: see migrate.test.ts). The mismatch is instead asserted lazily, the first time migrate()
// actually runs, and covered directly by a dedicated test so CI catches it regardless of whether any
// other test happens to call migrate().
const lastPostRepairBaseVersion = POST_REPAIR_BASE_STEPS[POST_REPAIR_BASE_STEPS.length - 1]?.version;
const postRepairBaseVersionMismatch =
  lastPostRepairBaseVersion !== EXPORT_SCHEMA_VERSION
    ? `migrate.ts: last POST_REPAIR_BASE_STEPS version (${String(lastPostRepairBaseVersion)}) must equal EXPORT_SCHEMA_VERSION (${EXPORT_SCHEMA_VERSION}).`
    : undefined;

/** Migrated data together with the pre-repair state kept for durable hydration. */
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
  // Runtime half of the invariant above: cheap to check on every call, and it stops corrupt
  // migration output reaching a caller instead of merely being caught by CI later.
  if (postRepairBaseVersionMismatch) {
    throw new Error(postRepairBaseVersionMismatch);
  }
  if (!raw || typeof raw !== "object") {
    const empty = emptyAppData();
    return { data: empty, repairBase: empty };
  }
  const record = raw as Record<string, unknown>;
  const version = parseSchemaVersion(record);
  if (version > EXPORT_SCHEMA_VERSION) throw new UnsupportedSchemaVersionError(version);

  // Accept either a { schemaVersion, data } wrapper or a bare AppData (legacy).
  let data = importCandidate(record) ?? undefined;

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
  const repairBase = normalize(data);
  runSteps(POST_REPAIR_BASE_STEPS);

  return {
    data: applyInternalClientRepairs(normalize(data), "2026-01-01T00:00:00.000Z"),
    repairBase,
  };
}

/** Migrate any supported persisted or exported shape to current {@link AppData}. Pure. */
export function migrate(raw: unknown): AppData {
  return migrateWithRepairBase(raw).data;
}
