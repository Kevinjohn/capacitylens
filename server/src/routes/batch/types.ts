import { type AppData } from "@capacitylens/shared/types/entities";
import type { FastifyRequest } from "fastify";
import type { LocalAccountFlows } from "../../accounts/createLocalAccountFlows";
import type { AuditRecord } from "../../audit";
import { BatchStateProjection } from "../../BatchStateProjection";
import { type Db } from "../../db";
import { type SanitizeWriteOptions } from "../../fieldPolicy";
import { type SyncOrder } from "../../syncOrdering";
import type { TableName } from "../../tables";
import type { AccountStore } from "../../accountStore";

import type { BatchRouteDependencies } from "../batchRoutes";

// The op-count cap is a client/server protocol limit; its rationale lives with the constant.
export { MAX_BATCH_OPS } from "@capacitylens/shared/data/transfer";

interface BatchOperationBase {
  table: TableName;
  id: string;
}

/** A validated PUT: its row is a record, whose id is checked against the op id when applied. */
export interface BatchPutOp extends BatchOperationBase {
  method: "PUT";
  row: Record<string, unknown>;
  accountId?: never;
}

/** A validated DELETE; scoped tables also carry the owning accountId. */
export interface BatchDeleteOp extends BatchOperationBase {
  method: "DELETE";
  accountId?: string;
  updatedAt?: string;
}

/** A validated archive of a lifecycle entity in its owning account. */
export interface BatchArchiveOp extends BatchOperationBase {
  method: "ARCHIVE";
  accountId: string;
  updatedAt?: string;
}

/**
 * One operation after `validateRequest` has checked it. Handlers rely on these shapes instead of
 * re-checking them; untrusted request bodies never take this type.
 */
export type BatchOp = BatchPutOp | BatchDeleteOp | BatchArchiveOp;

export interface ParsedBatchRequest {
  ops: BatchOp[];
  syncOrder: SyncOrder | null;
}

export interface BatchRevision {
  table: string;
  id: string;
  createdAt: string;
  updatedAt: string;
  rewrite?: true;
}

export interface ApplyBatchOperationParameters {
  opIndex: number;
  op: BatchOp;
  req: FastifyRequest;
  db: Db;
  store: AccountStore;
  state: AppData;
  projection: BatchStateProjection;
  mintedInternalIds: Set<string>;
  revisions: BatchRevision[];
  auditRecords: Array<AuditRecord | null>;
  lifecycleArchives: Array<{ table: string; id: string; archived: boolean }>;
  syncOrder: SyncOrder | null;
  optimisticConcurrency: boolean;
  multiAccount: boolean;
  projectedWorkspaceCount: number;
  accountFlows: LocalAccountFlows;
  fieldVisFor: (table: string, accountId: unknown) => SanitizeWriteOptions;
  redactWriteEcho: BatchRouteDependencies["redact"];
}
