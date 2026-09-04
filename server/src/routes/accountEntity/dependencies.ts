import type { CommandIdentity } from "@capacitylens/shared/account/types";
import type { Action } from "@capacitylens/shared/domain/access";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { LocalAccountFlows } from "../../accounts/localAccountFlows";
import type { AuditRecord } from "../../audit";
import type { AuthMode } from "../../auth";
import { type Db } from "../../db";
import type { SanitizeWriteOptions } from "../../fieldPolicy";
import type { TenantStore } from "../../tenantStore";

export interface AccountEntityRouteDependencies {
  db: Db;
  store: TenantStore;
  authMode: AuthMode;
  multiAccount: boolean;
  /** Already resolved from AppOptions (`opts.optimisticConcurrency !== false`). */
  optimisticConcurrency: boolean;
  flows: LocalAccountFlows;
  authorize: (
    req: FastifyRequest,
    reply: FastifyReply,
    accountId: string,
    action: Action,
    options?: { concealNonMembership?: boolean },
  ) => boolean;
  /** Parses/validates the account command headers; throws AccountContractError on a bad pair. */
  command: (req: FastifyRequest) => CommandIdentity;
  /** The strict variant: a complete, well-formed header pair or null (never throws). */
  replayCommand: (req: FastifyRequest) => CommandIdentity | null;
  fieldVisibility: (req: FastifyRequest, table: string, accountId: unknown) => SanitizeWriteOptions;
  redact: (table: string, row: Record<string, unknown>, vis: SanitizeWriteOptions) => Record<string, unknown>;
  commitProductAudit: (reply: FastifyReply, record: AuditRecord, mutation: () => void) => boolean;
  drainProductAudit: (reply: FastifyReply) => boolean;
  /** Tenant-ownership predicate shared with every other mutating route (app.ts owns it). */
  ownsRow: (existing: { accountId?: unknown } | undefined, accountId: unknown) => boolean;
  /** Optimistic-concurrency predicate shared with the PUT/PATCH/batch paths (app.ts owns it). */
  isStaleWrite: (
    existing: Record<string, unknown> | undefined,
    row: Record<string, unknown>,
    requirePrecondition?: boolean,
  ) => boolean;
  enqueueAudit: (record: AuditRecord) => void;
  fail: (reply: FastifyReply, error: unknown) => FastifyReply;
  accountFail: (reply: FastifyReply, error: unknown) => FastifyReply;
}
