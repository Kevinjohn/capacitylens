import { type AppData } from "@capacitylens/shared/types/entities";
import type { FastifyRequest } from "fastify";
import type { LocalAccountFlows } from "../../accounts/createLocalAccountFlows";
import type { AuditRecord } from "../../audit";
import { BatchStateProjection } from "../../BatchStateProjection";
import { type Db } from "../../db";
import { type SanitizeWriteOptions } from "../../fieldPolicy";
import { type SyncOrder } from "../../syncOrdering";
import type { TenantStore } from "../../tenantStore";

import type { BatchRouteDependencies } from "../batchRoutes";

// The op-count cap is a client/server protocol limit; its rationale lives with the constant.
export { MAX_BATCH_OPS } from "@capacitylens/shared/data/transfer";

export interface BatchOp {
  method: "PUT" | "DELETE" | "ARCHIVE";
  table: string;
  id: string;
  row?: Record<string, unknown>;
  accountId?: string;
  updatedAt?: string;
}

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
  store: TenantStore;
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
