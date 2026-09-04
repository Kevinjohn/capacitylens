import type { Db } from "../db";
import { DATABASE_MIGRATION_TABLE } from "./constants";
import { createHash } from "node:crypto";
export interface DatabaseMigration {
  version: number;
  name: string;
  checksum: string;
  /** Return commit-dependent reporting work when an outcome must not be published on rollback. */
  up(db: Db): void | (() => void);
}

export interface DatabaseMigrationPlan {
  fromVersion: number;
  toVersion: number;
  fresh: boolean;
  migrations: ReadonlyArray<Pick<DatabaseMigration, "version" | "name" | "checksum">>;
}

export interface DatabaseMigrationHooks {
  /** Test/rehearsal seam: runs after the migration, history row and version stamps, immediately
   * before COMMIT. Throwing (or terminating the process) must leave the previous version intact. */
  beforeCommit?(migration: Readonly<Pick<DatabaseMigration, "version" | "name" | "checksum">>): void;
}

export const MIGRATION_HISTORY_SQL = `
CREATE TABLE IF NOT EXISTS ${DATABASE_MIGRATION_TABLE} (
  version INTEGER NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK(length(checksum) = 64),
  appliedAt TEXT NOT NULL
) STRICT;
`;

export function defineMigration(
  version: number,
  name: string,
  definition: string,
  up: (db: Db) => void | (() => void),
): DatabaseMigration {
  // The definition is the immutable, reviewable migration manifest. Include every SQL block and
  // named repair revision that contributes to the step. Once released, changing it changes the
  // checksum and every already-upgraded database will refuse to open instead of drifting silently.
  const checksum = createHash("sha256")
    .update("capacitylens-sqlite-migration\0")
    .update(String(version))
    .update("\0")
    .update(name)
    .update("\0")
    .update(definition)
    .digest("hex");
  return { version, name, checksum, up };
}

/**
 * Per-version allow-list of PRIOR definition checksums this build still accepts on an
 * ALREADY-APPLIED migration row. Every entry is one explicitly reviewed, one-time amendment; the
 * map is empty for every migration whose definition has never changed after shipping. This is NOT a
 * general "ignore mismatches" relaxation — only the exact (version → historical-checksum) pairs
 * listed here are tolerated, and any OTHER checksum drift (on these versions or any other) still
 * refuses startup with the same error.
 *
 * v11 amendment (alpha line only): the ORIGINAL v11 definition
 * 'repair:promote-oldest-active-member-when-ownerless:v1' promoted the OLDEST active member
 * REGARDLESS of role when an account went ownerless; the amended definition
 * 'repair:promote-highest-role-tier-active-member-when-ownerless:v2' promotes the HIGHEST role tier
 * (tie-broken by earliest membership). The edit was made IN PLACE rather than as a follow-up
 * migration because the old SQL destroyed the original roles, so a forward repair can no longer
 * distinguish a wrongly-promoted low-tier member from a legitimate owner. Any database opened by a
 * previous build (up to and including v0.22.0-alpha.0 / commit fd5374b — live alpha deployments and
 * dev DBs) recorded the OLD v11 checksum in its ledger; without this one-time amendment those
 * installs would checksum-mismatch on boot and refuse to start, bricking already-upgraded databases.
 *
 * RESIDUAL RISK, ACCEPTED FOR THE ALPHA LINE: a database that ran the OLD v11 may carry a
 * wrongly-promoted low-tier owner that the amended v11 would have chosen differently; that row is
 * NOT re-repaired here (the destroyed roles make a correct forward repair impossible). This residual
 * case is tracked by the DECISIONS.md "REVISIT before a stable release" flag on the ownerless-repair
 * decision. The ledger row is LEFT UNTOUCHED — we accept the superseded checksum during read-only
 * planning rather than rewriting history, so assertMigrationHistory stays a pure read.
 */
const SUPERSEDED_MIGRATION_CHECKSUMS: ReadonlyMap<number, readonly string[]> = new Map([
  [11, ["057242fc8e358bebf0a188395e9289d2661f6a89e843bc091e718d003f013f5e"]],
]);

/** True only when `checksum` is an explicitly superseded prior definition for `version` (see
 * {@link SUPERSEDED_MIGRATION_CHECKSUMS}). Any unlisted checksum is a genuine drift and returns false. */
export function isSupersededMigrationChecksum(version: number, checksum: string): boolean {
  return SUPERSEDED_MIGRATION_CHECKSUMS.get(version)?.includes(checksum) ?? false;
}
