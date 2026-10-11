import { SINGLE_COMPANY_CAP_MESSAGE } from "@capacitylens/shared/account/policy";
import type { Db } from "../../db";
import { IMMUTABLE_ACCOUNT_FIELDS } from "../../validate";

// Keep this re-export for callers that still import the account entity route module.
export { SINGLE_COMPANY_CAP_MESSAGE };

/** Returns the company count used by account creation policy. */
export function countAccounts(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
}

interface IsAccountCreateCappedInput {
  db: Db;
  multiAccount: boolean;
}

/**
 * True when creating a new `accounts` row right now would violate the single-company cap: the table
 * already holds ≥1 row and the instance has not opted into `multiAccount`. Callers must call this
 * only for the CREATE case (no existing row). An UPDATE/DELETE of an already-existing account is
 * never capped; enforcement is create-time only, per AppOptions.multiAccount.
 */
export function isAccountCreateCapped({ db, multiAccount }: IsAccountCreateCappedInput): boolean {
  return !multiAccount && countAccounts(db) > 0;
}

/** Server-owned revision fields are result metadata, not semantic account-command input. */
export function buildCanonicalAccountProductPayload(row: Record<string, unknown>): Record<string, unknown> {
  const canonical = { ...row };
  delete canonical.createdAt;
  delete canonical.updatedAt;
  return canonical;
}

/** Reports a change to an already-set immutable account calendar field.
 * Unchanged echoes and fields omitted then pinned by sanitizeWrite pass; unset stored values may be established once.
 * Ordinary supplied malformed values must be rejected before this predicate. Creation always passes.
 */
export function hasFrozenAccountFieldChanges(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): boolean {
  if (!existing) return false;
  return IMMUTABLE_ACCOUNT_FIELDS.some((field) => existing[field] !== undefined && incoming[field] !== existing[field]);
}
