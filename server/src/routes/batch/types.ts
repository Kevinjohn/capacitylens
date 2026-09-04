import { type AppData } from "@capacitylens/shared/types/entities";
import type { FastifyRequest } from "fastify";
import type { LocalAccountFlows } from "../../accounts/localAccountFlows";
import type { AuditRecord } from "../../audit";
import { BatchStateProjection } from "../../batchProjection";
import { type Db } from "../../db";
import { type SanitizeWriteOptions } from "../../fieldPolicy";
import { type SyncOrder } from "../../syncOrdering";
import type { TenantStore } from "../../tenantStore";

import type { BatchRouteDependencies } from "../batchRoutes";

// Cap on ops per POST /api/batch request (the MAX_IMPORT_RECORDS precedent, applied to the sync
// path). BODY_LIMIT bounds request BYTES, but not request WORK: every operation is sanitized,
// authorized, validated and applied to the in-memory projection. The transaction reads each
// affected account slice once, then indexed point/reverse lookups keep per-op validation and
// projection updates proportional to each operation's referenced/affected rows rather than the
// whole tenant. Op COUNT is therefore the remaining request-controlled multiplier. 5 000 is
// generous headroom over the largest realistic full-slice diff the client sync adapter produces
// (a whole busy agency's slice is low-thousands of rows) while bounding a crafted/looping flood.
// The inclusive boundary integration test applies 5 000 real existing-row updates and enforces a
// four-second handler budget under the supported Node 24 gate, leaving headroom below the packaged
// five-second container healthcheck timeout. Keep that budget, this cap and the client's matching
// MAX_OPS_PER_BATCH in lockstep; an in-process queue cannot shorten one synchronous SQLite turn.
// Checked BEFORE the pre-scan and tx, so an over-cap batch writes nothing.
// Exported for the test that pins the boundary.
export const MAX_BATCH_OPS = 5000;

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
