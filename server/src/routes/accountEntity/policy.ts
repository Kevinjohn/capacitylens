import { SINGLE_COMPANY_CAP_MESSAGE } from "@capacitylens/shared/account/policy";
import { type Db } from "../../db";
import { IMMUTABLE_ACCOUNT_FIELDS } from "../../validate";

/** Auth-on closure of the generic account-create paths. Now that POST /api/orgs exists (P1.8 — the
 * ATOMIC account + built-in Internal client + owner-membership create), the old "onboarding
 * exemption" was an authz bypass: any authenticated user (even one with NO membership anywhere)
 * could mint bare `accounts` rows that NEVER become usable — no membership is ever backfilled (only
 * the Internal client backfills, at restart), so each row is a permanent orphan its own creator
 * cannot read. With auth on, both remaining create vectors (PUT-as-create here, batch PUT-as-create)
 * refuse with this message; /api/orgs covers every legitimate case (first-run bootstrap at zero
 * accounts, an Owner/Admin or bootstrap-token caller under multiAccount). authMode 'off' keeps the
 * open generic create — trusted-local parity: the demo/local/e2e client syncs new companies through
 * the entity routes. */
export const ACCOUNT_CREATE_CLOSED_MESSAGE =
  "Accounts cannot be created through this endpoint when authentication is on. Use POST /api/orgs.";

// SINGLE_COMPANY_CAP_MESSAGE (owner policy — see AppOptions.multiAccount / CLAUDE.md) now lives in
// @capacitylens/shared/account/policy: every route that could add a SECOND `accounts` row — this
// PUT, the batch loop, POST /api/orgs — shares that one shared-package constant so the rule can't
// drift between vectors. Re-exported here so app.ts's existing `from "./routes/accountEntityRoutes"`
// import keeps working unchanged.
export { SINGLE_COMPANY_CAP_MESSAGE };

/** The P1.14 frozen-field refusal, shared by PUT, PATCH and the batch loop (it was three identical
 * string literals, which is exactly how a message drifts between vectors). */
export const ACCOUNT_FROZEN_FIELDS_MESSAGE =
  "Language, week start and time zone are set when the company is created and cannot be changed.";

/** SELECT COUNT(*) FROM accounts — the cap's sole precondition. Same query POST /api/orgs used
 *  before the cap existed; kept as one function so every enforcement point reads the identical
 *  number (never re-derived ad hoc at each call site). */
export function countAccounts(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
}

/**
 * True when creating a NEW `accounts` row right now would violate the single-company cap: the table
 * already holds ≥1 row AND the instance has not opted into `multiAccount`. Callers MUST call this
 * only for the CREATE case (no existing row) — an UPDATE/DELETE of an already-existing account is
 * never capped; enforcement is create-time only, per AppOptions.multiAccount.
 */
export function accountCreateCapped(db: Db, multiAccount: boolean): boolean {
  return !multiAccount && countAccounts(db) > 0;
}

/** Server-owned revision fields are result metadata, not semantic account-command input. */
export function canonicalAccountProductPayload(row: Record<string, unknown>): Record<string, unknown> {
  const canonical = { ...row };
  delete canonical.createdAt;
  delete canonical.updatedAt;
  return canonical;
}

/**
 * True when a sanitised accounts write would CHANGE an already-set frozen field (P1.14) — the
 * violation signal the PUT/PATCH/batch handlers all turn into a 409 — the batch path throws an
 * AccountContractError with code CONFLICT, which the sync client maps through
 * statusForAccountFailure to the same 409 (its authoritative-reload trigger), not a 400.
 *
 * Reports a violation ONLY when `existing` has a stored value AND the sanitised incoming value
 * differs. Four deliberate rules:
 *  - Change, not presence: the sync adapter re-sends the WHOLE row on any edit (e.g. a rename),
 *    so an unchanged frozen value MUST pass — only a real change is a violation.
 *  - A missing stored value may be set once, preserving legacy/minimal API-created accounts.
 *  - sanitizeWrite pins an existing value when malformed input is dropped, making it a no-op.
 *  - No existing row → creation, when these values are legitimately SET → never a violation.
 *
 * @param existing the stored row (undefined on a create — always passes)
 * @param incoming the sanitised candidate row, before it is persisted
 */
export function accountFieldsFrozen(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): boolean {
  if (!existing) return false;
  return IMMUTABLE_ACCOUNT_FIELDS.some((field) => existing[field] !== undefined && incoming[field] !== existing[field]);
}
