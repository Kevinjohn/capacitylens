import type { Db } from "../db";
import { hasColumn } from "../schema";
import { tx } from "../txn";
import { normalizedTableCreateSql } from "./state";

const TRACKING_TABLE = "account_member_sign_in_tracking";
const OBSERVATION_COLUMN = "signInConfirmed";

/** Frozen v26 migration definition. The setting is represented by row presence so the database
 * stores neither an enablement timestamp nor any other history. The per-membership value is a
 * nullable boolean: NULL while tracking is off, false after opt-in, true after a successful sign-in. */
export const MEMBER_SIGN_IN_TRACKING_V26_DEFINITION = [
  `guard:PRAGMA table_info(account_members):${OBSERVATION_COLUMN}-missing`,
  `ALTER TABLE account_members ADD COLUMN ${OBSERVATION_COLUMN} TEXT CHECK(${OBSERVATION_COLUMN} IS NULL OR ${OBSERVATION_COLUMN} IN ('false', 'true'));`,
  `CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (accountId TEXT NOT NULL PRIMARY KEY) STRICT;`,
  "privacy:no-timestamps-no-session-history-no-backfill:v1",
].join("\n-- migration component --\n");

/** Add the default-off tracking shape without changing any existing member's state. */
export function migrateMemberSignInTrackingV26(db: Db): void {
  if (!hasColumn(db, "account_members", OBSERVATION_COLUMN)) {
    db.exec(
      `ALTER TABLE account_members ADD COLUMN ${OBSERVATION_COLUMN} TEXT ` +
        `CHECK(${OBSERVATION_COLUMN} IS NULL OR ${OBSERVATION_COLUMN} IN ('false', 'true'));`,
    );
  }
  db.exec(`CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (accountId TEXT NOT NULL PRIMARY KEY) STRICT;`);
}

export function assertMemberSignInTrackingSchemaCurrent(db: Db): void {
  const observation = (
    db.prepare("PRAGMA table_info(account_members)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>
  ).find(({ name }) => name === OBSERVATION_COLUMN);
  const trackingColumns = db.prepare(`PRAGMA table_info(${TRACKING_TABLE})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }>;
  const trackingSql = normalizedTableCreateSql(db, TRACKING_TABLE);
  const problems: string[] = [];
  if (!observation) problems.push(`missing account_members.${OBSERVATION_COLUMN}`);
  else {
    if (observation.type.toUpperCase() !== "TEXT") {
      problems.push(`account_members.${OBSERVATION_COLUMN} must be TEXT`);
    }
    if (observation.notnull !== 0) problems.push(`account_members.${OBSERVATION_COLUMN} must be nullable`);
  }
  if (
    trackingColumns.length !== 1 ||
    trackingColumns[0]?.name !== "accountId" ||
    trackingColumns[0]?.type.toUpperCase() !== "TEXT" ||
    trackingColumns[0]?.notnull !== 1 ||
    trackingColumns[0]?.pk !== 1
  ) {
    problems.push(`${TRACKING_TABLE} must contain only its TEXT accountId primary key`);
  }
  if (!trackingSql.endsWith(" strict")) problems.push(`${TRACKING_TABLE} must be STRICT`);
  if (problems.length > 0) throw new Error(`Member sign-in tracking schema mismatch: ${problems.join("; ")}.`);
}

export interface MemberSignInTrackingSnapshot {
  enabled: boolean;
  confirmations: ReadonlyMap<string, boolean>;
}

/** Read only the coarse yes/no facts for one account. No identity timestamps are consulted. */
export function memberSignInTrackingSnapshot(db: Db, accountId: string): MemberSignInTrackingSnapshot {
  const enabled = db.prepare(`SELECT 1 FROM ${TRACKING_TABLE} WHERE accountId = ?`).get(accountId) !== undefined;
  if (!enabled) return { enabled: false, confirmations: new Map() };
  const rows = db
    .prepare(`SELECT userId, ${OBSERVATION_COLUMN} FROM account_members WHERE accountId = ?`)
    .all(accountId) as Array<{ userId: string; signInConfirmed: string | null }>;
  return {
    enabled: true,
    confirmations: new Map(rows.map((row) => [row.userId, row.signInConfirmed === "true"])),
  };
}

/** Owner-controlled privacy switch. Enabling begins a fresh observation window and truthfully
 * confirms the authenticated owner who turned it on. Disabling deletes every stored confirmation. */
export function setMemberSignInTracking(
  db: Db,
  accountId: string,
  actorPrincipalId: string,
  enabled: boolean,
): { enabled: boolean; changed: boolean } {
  return tx(
    db,
    () => {
      const current = db.prepare(`SELECT 1 FROM ${TRACKING_TABLE} WHERE accountId = ?`).get(accountId) !== undefined;
      if (current === enabled) return { enabled, changed: false };
      if (enabled) {
        db.prepare(`INSERT INTO ${TRACKING_TABLE} (accountId) VALUES (?)`).run(accountId);
        db.prepare(
          `UPDATE account_members
              SET ${OBSERVATION_COLUMN} = CASE WHEN userId = ? AND status = 'active' THEN 'true' ELSE 'false' END
            WHERE accountId = ?`,
        ).run(actorPrincipalId, accountId);
      } else {
        db.prepare(`DELETE FROM ${TRACKING_TABLE} WHERE accountId = ?`).run(accountId);
        db.prepare(`UPDATE account_members SET ${OBSERVATION_COLUMN} = NULL WHERE accountId = ?`).run(accountId);
      }
      return { enabled, changed: true };
    },
    "immediate",
  );
}

/** Successful identity authentication records one bit for each opted-in account where the
 * principal currently has active access. It records no time and does not touch disabled rows. */
export function confirmTrackedMemberSignIn(db: Db, principalId: string): void {
  db.prepare(
    `UPDATE account_members
        SET ${OBSERVATION_COLUMN} = 'true'
      WHERE userId = ?
        AND status = 'active'
        AND ${OBSERVATION_COLUMN} = 'false'
        AND EXISTS (
          SELECT 1 FROM ${TRACKING_TABLE} AS tracking
           WHERE tracking.accountId = account_members.accountId
        )`,
  ).run(principalId);
}

/** A deliberate access reset starts a new confirmation window in every opted-in account. */
export function clearTrackedMemberSignIn(db: Db, principalId: string): void {
  db.prepare(
    `UPDATE account_members
        SET ${OBSERVATION_COLUMN} = 'false'
      WHERE userId = ?
        AND ${OBSERVATION_COLUMN} IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM ${TRACKING_TABLE} AS tracking
           WHERE tracking.accountId = account_members.accountId
        )`,
  ).run(principalId);
}

export function removeMemberSignInTrackingForAccount(db: Db, accountId: string): void {
  db.prepare(`DELETE FROM ${TRACKING_TABLE} WHERE accountId = ?`).run(accountId);
}
