import { parseApprovedDomains } from "@capacitylens/shared/account/approvedDomains";
import { isJoiningPolicy } from "@capacitylens/shared/account/types";
import type { JoiningPolicySettings } from "@capacitylens/shared/account/types";
import type { Db } from "../db";

export function readJoiningPolicy(db: Db, accountId: string): JoiningPolicySettings {
  const row = db
    .prepare("SELECT policy, approvedDomains FROM account_joining_policies WHERE accountId = ?")
    .get(accountId) as { policy: string; approvedDomains: string } | undefined;
  if (!row) return { policy: "invitation_only", approvedDomains: [] };
  const domains = parseApprovedDomains(JSON.parse(row.approvedDomains) as unknown);
  if (!isJoiningPolicy(row.policy) || domains === null) throw new Error("Stored joining policy is invalid.");
  return { policy: row.policy, approvedDomains: domains };
}

/** Caller owns authorization and the account-scoped write transaction. */
export function writeJoiningPolicy(db: Db, accountId: string, settings: JoiningPolicySettings): JoiningPolicySettings {
  const domains = parseApprovedDomains(settings.approvedDomains);
  if (!isJoiningPolicy(settings.policy) || domains === null) throw new Error("Invalid joining policy settings.");
  db.prepare(
    `INSERT INTO account_joining_policies (accountId, policy, approvedDomains, updatedAt)
    VALUES (?, ?, ?, ?) ON CONFLICT(accountId) DO UPDATE SET
    policy = excluded.policy, approvedDomains = excluded.approvedDomains, updatedAt = excluded.updatedAt`,
  ).run(accountId, settings.policy, JSON.stringify(domains), new Date().toISOString());
  return { policy: settings.policy, approvedDomains: domains };
}

export function removeJoiningPolicy(db: Db, accountId: string): void {
  db.prepare("DELETE FROM account_joining_policies WHERE accountId = ?").run(accountId);
}
