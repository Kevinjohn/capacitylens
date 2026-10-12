import type { Membership } from "@capacitylens/shared/account/types";
import type { AccountMember } from "../../controlTables";
import type { Db } from "../../db";
import { readSecurityRevision } from "../state";
import { ACCOUNT_POLICY_VERSION } from "./contracts";

/**
 * Maps a stored member row to the policy fields used for account membership.
 */
export function readMembership(db: Db, row: AccountMember): Membership {
  return {
    workspaceId: row.accountId,
    principalId: row.userId,
    role: row.role,
    status: row.status,
    joinedAt: row.createdAt,
    membershipRevision: String(readSecurityRevision(db, row.userId)),
    policyVersion: ACCOUNT_POLICY_VERSION,
  };
}

/**
 * Reads security revisions in bounded batches without mutating database rows.
 * Principals without a revision row are absent from the returned map; callers must default them to zero.
 */
export function readSecurityRevisionsByPrincipalId(db: Db, principalIds: readonly string[]): Map<string, number> {
  const revisions = new Map<string, number>();
  for (let offset = 0; offset < principalIds.length; offset += 500) {
    const chunk = principalIds.slice(offset, offset + 500);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT principalId, revision FROM account_security_revisions WHERE principalId IN (${placeholders})`)
      .all(...chunk) as { principalId: string; revision?: number }[];
    for (const row of rows) revisions.set(row.principalId, Number(row.revision ?? 0));
  }
  return revisions;
}

/**
 * Combines the actor and target security revisions into the command’s authority token.
 */
export function buildAuthorityRevision(actorRevision: number, targetRevision: number): string {
  return `actor:${actorRevision};target:${targetRevision}`;
}
