import type { Membership } from "@capacitylens/shared/account/types";
import type { AccountMember } from "../../controlTables";
import type { Db } from "../../db";
import { getSecurityRevision } from "../state";
import { ACCOUNT_POLICY_VERSION } from "./contracts";

export function membership(db: Db, row: AccountMember): Membership {
  return {
    workspaceId: row.accountId,
    principalId: row.userId,
    role: row.role,
    status: row.status,
    joinedAt: row.createdAt,
    membershipRevision: String(getSecurityRevision(db, row.userId)),
    policyVersion: ACCOUNT_POLICY_VERSION,
  };
}

/**
 * Bulk variant of `getSecurityRevision`, for listMemberships (only multi-row read here — every
 * other call site above stays on the single-row `membership()`/`getSecurityRevision` path). Chunks
 * the IN-list at 500 (mirrors betterAuthIdentityPort.ts's getPrincipalSummaries) so a large
 * workspace never builds one unbounded query. A principal with no stored revision row is absent
 * from the returned Map — callers must apply the same `?? 0` default `getSecurityRevision` uses.
 */
export function securityRevisionsByPrincipal(db: Db, principalIds: readonly string[]): Map<string, number> {
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

export function authorityRevision(actorRevision: number, targetRevision: number): string {
  return `actor:${actorRevision};target:${targetRevision}`;
}
