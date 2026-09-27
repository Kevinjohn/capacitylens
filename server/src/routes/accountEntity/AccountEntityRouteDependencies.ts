import type { StaleWriteInput } from "../routeShared";
import type { AuthorizeRouteInput } from "../routeShared";
import type { CommandIdentity } from "@capacitylens/shared/account/types";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { LocalAccountFlows } from "../../accounts/createLocalAccountFlows";
import type { AuditRecord } from "../../audit";
import type { AccountMode } from "../../auth";
import { type Db } from "../../db";
import type { SanitizeWriteOptions } from "../../fieldPolicy";
import type { TenantStore } from "../../tenantStore";

export interface AccountEntityRouteDependencies {
  db: Db;
  store: TenantStore;
  authMode: AccountMode;
  multiAccount: boolean;
  /** Already resolved from AppOptions (`opts.optimisticConcurrency !== false`). */
  optimisticConcurrency: boolean;
  flows: LocalAccountFlows;
  authorize: (input: AuthorizeRouteInput) => boolean;
  /** Parses/validates the account command headers; throws AccountContractError on a bad pair. */
  command: (req: FastifyRequest) => CommandIdentity;
  /** The strict variant: a complete, well-formed header pair or null (never throws). */
  replayCommand: (req: FastifyRequest) => CommandIdentity | null;
  fieldVisibility: (req: FastifyRequest, table: string, accountId: unknown) => SanitizeWriteOptions;
  redact: (table: string, row: Record<string, unknown>, visibility: SanitizeWriteOptions) => Record<string, unknown>;
  commitProductAudit: (reply: FastifyReply, record: AuditRecord, mutation: () => void) => boolean;
  drainProductAudit: (reply: FastifyReply) => boolean;
  /** Tenant-ownership predicate shared with every other mutating route (app.ts owns it). */
  ownsRow: (existing: { accountId?: unknown } | undefined, accountId: unknown) => boolean;
  /** Optimistic-concurrency predicate shared with the PUT/PATCH/batch paths (app.ts owns it). */
  isStaleWrite: (input: StaleWriteInput) => boolean;
  enqueueAudit: (record: AuditRecord) => void;
  fail: (reply: FastifyReply, error: unknown) => FastifyReply;
  accountFail: (reply: FastifyReply, error: unknown) => FastifyReply;
}
