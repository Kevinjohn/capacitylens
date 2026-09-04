import type { FastifyInstance } from "fastify";
import type { AccountEntityRouteDependencies } from "./accountEntity/dependencies";
import { createAccountLifecycleHandlers } from "./accountEntity/lifecycleHandlers";
import { createAccountWriteHandlers } from "./accountEntity/writeHandlers";
export type { AccountEntityRouteDependencies } from "./accountEntity/dependencies";
export {
  ACCOUNT_CREATE_CLOSED_MESSAGE,
  ACCOUNT_FROZEN_FIELDS_MESSAGE,
  accountCreateCapped,
  accountFieldsFrozen,
  canonicalAccountProductPayload,
  countAccounts,
  SINGLE_COMPANY_CAP_MESSAGE,
} from "./accountEntity/policy";

// THE SINGLE HOME FOR `accounts`-ROW WRITE RULES.
//
// `accounts` is the one table in TABLES that is NOT tenant-scoped: it has no `accountId` column, so
// every guard the generic /api/:entity routes derive from `row.accountId` (the isScopedTable
// authorize gate, ownsRow's immutability check, the scoped DELETE's owner assertion) is a no-op for
// it. The generic routes therefore grew ~25 hand-replicated `entity === "accounts"` branches — one
// per verb per rule — and any rule added to one verb but not another silently applied SCOPED-entity
// semantics to an account row. These dedicated STATIC routes own the account rules once each;
// Fastify matches them ahead of the parametric /api/:entity routes, which now refuse `accounts`
// outright. POST /api/batch keeps its own account handling (a client sync diff genuinely carries
// accounts PUT ops — see src/data/syncOps.ts) but shares every predicate exported below, so the two
// paths cannot drift.

/**
 * Register the dedicated `accounts` write routes. They are STATIC paths (`/api/accounts…`), which
 * find-my-way matches ahead of the parametric `/api/:entity` routes, so an account row can never
 * reach the generic handlers and pick up scoped-entity semantics.
 */
export function registerAccountEntityRoutes(app: FastifyInstance, dependencies: AccountEntityRouteDependencies): void {
  const { post, delete: deleteAccount } = createAccountLifecycleHandlers(dependencies);
  const { put, patch } = createAccountWriteHandlers(dependencies);
  app.post("/api/accounts", post);
  app.put("/api/accounts/:id", put);
  app.patch("/api/accounts/:id", patch);
  app.delete("/api/accounts/:id", deleteAccount);
}
