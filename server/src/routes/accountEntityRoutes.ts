import type { FastifyInstance } from "fastify";
import type { AccountEntityRouteDependencies } from "./accountEntity/AccountEntityRouteDependencies";
import { createAccountLifecycleHandlers } from "./accountEntity/lifecycleHandlers";
import { createAccountWriteHandlers } from "./accountEntity/writeHandlers";
export type { AccountEntityRouteDependencies } from "./accountEntity/AccountEntityRouteDependencies";
export {
  isAccountCreateCapped,
  hasFrozenAccountFieldChanges,
  buildCanonicalAccountProductPayload,
  countAccounts,
  SINGLE_COMPANY_CAP_MESSAGE,
} from "./accountEntity/policy";

// Dedicated account routes handle the unscoped accounts table before generic entity routes.
// Batch account writes share the same policy predicates so creation and immutable-field rules stay aligned.

/**
 * Register the dedicated `accounts` write routes. They are static paths (`/api/accounts…`), which
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
