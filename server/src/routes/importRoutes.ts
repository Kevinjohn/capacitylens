import type { AuthorizeBasicInput } from "./routeShared";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccountAdminPort } from "@capacitylens/shared/account/ports";
import type { Role } from "@capacitylens/shared/account/types";
import { canSeePrivateNames } from "@capacitylens/shared/domain/access";
import { seed } from "@capacitylens/shared/data/seed";
import { parseData, MAX_IMPORT_RECORDS } from "@capacitylens/shared/data/transfer";
import { APP_DATA_KEYS, type AppData } from "@capacitylens/shared/types/entities";
import type { AuditRecord } from "../audit";
import type { AccountMode } from "../auth";
import { buildCompleteAccountSlice, insertAll, replaceAccountSlice, wipe } from "../db";
import type { Db } from "../db";
import { readCurrentRequestAbortSignal } from "../requestAbort";
import type { runImportWorker } from "../runImportWorker";
import type { TenantStore } from "../tenantStore";
import { tx } from "../txn";
import { WorkQueueFullError } from "../workQueue";

type AuthorizeImportInput = Omit<AuthorizeBasicInput, "action"> & { action: "purge" };

type ImportAccountAdministration = AccountAdminPort & {
  roleForPrincipalInWorkspace(principalId: string, workspaceId: string): Role | null;
};

const IMPORT_SNAPSHOT_STALE_MESSAGE =
  "The company data changed while the import was being prepared. Retry the import from the latest data.";

class ImportSnapshotConflictError extends Error {
  constructor() {
    super(IMPORT_SNAPSHOT_STALE_MESSAGE);
    this.name = "ImportSnapshotConflictError";
  }
}

function buildCanonicalJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(buildCanonicalJson).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${buildCanonicalJson(child)}`).join(",")}}`;
}

/** Fingerprint only the scoped rows an import replaces. Row and field ordering are normalized so
 * equivalent SQLite reads compare equal while any accepted tenant mutation changes the token. */
function buildImportSnapshotFingerprint(slice: AppData): string {
  const scoped = Object.fromEntries(
    APP_DATA_KEYS.filter((table) => table !== "accounts").map((table) => [
      table,
      [...slice[table]].sort((left, right) => left.id.localeCompare(right.id)),
    ]),
  );
  return createHash("sha256").update(buildCanonicalJson(scoped)).digest("base64url");
}

export interface ImportRouteDependencies {
  db: Db;
  store: TenantStore;
  authMode: AccountMode;
  allowReset: boolean;
  accountAdminPort: ImportAccountAdministration;
  authorize: (input: AuthorizeImportInput) => boolean;
  executeImportWorker: typeof runImportWorker;
  commitProductAudit: (reply: FastifyReply, record: AuditRecord, mutation: () => void) => boolean;
  fail: (reply: FastifyReply, error: unknown) => FastifyReply;
}

interface ImportRequestBody {
  accountId: string;
  data: unknown;
}

function readImportRequestBody(body: unknown): ImportRequestBody | undefined {
  if (body === null || typeof body !== "object" || !("accountId" in body) || typeof body.accountId !== "string") {
    return undefined;
  }
  return { accountId: body.accountId, data: "data" in body ? body.data : undefined };
}

function isResetSeedRequested(body: unknown): boolean {
  return body !== null && typeof body === "object" && "seed" in body && Boolean(body.seed);
}

interface AuthorizedImportUserInput {
  req: FastifyRequest;
  reply: FastifyReply;
  body: ImportRequestBody;
  dependencies: ImportRouteDependencies;
}

function authorizeImportUser({
  req,
  reply,
  body,
  dependencies,
}: AuthorizedImportUserInput): NonNullable<FastifyRequest["user"]> | undefined {
  if (!dependencies.authorize({ req, reply, accountId: body.accountId, action: "purge" })) return undefined;
  const user = req.user;
  if (user === null) {
    dependencies.fail(reply, new Error("Authenticated import request has no user."));
    return undefined;
  }
  if (dependencies.authMode === "off") return user;
  const role = dependencies.accountAdminPort.roleForPrincipalInWorkspace(user.id, body.accountId);
  if (role === null || !canSeePrivateNames(role)) {
    void reply.code(403).send({ error: "Only the account owner can import data." });
    return undefined;
  }
  return user;
}

function sendImportFailure(reply: FastifyReply, error: unknown, dependencies: ImportRouteDependencies): FastifyReply {
  if (error instanceof WorkQueueFullError) {
    reply.header("retry-after", "1");
    return reply.code(503).send({ error: error.message, code: "IMPORT_BUSY", retryable: true });
  }
  if (error instanceof ImportSnapshotConflictError) {
    return reply.code(409).send({ error: error.message, code: "IMPORT_SNAPSHOT_STALE" });
  }
  return dependencies.fail(reply, error);
}

async function handleImport(
  req: FastifyRequest,
  reply: FastifyReply,
  dependencies: ImportRouteDependencies,
): Promise<unknown> {
  const body = readImportRequestBody(req.body);
  if (body === undefined) return reply.code(400).send({ error: "accountId is required" });
  const user = authorizeImportUser({ req, reply, body, dependencies });
  if (user === undefined) return;
  let incoming;
  try {
    incoming = parseData(JSON.stringify(body.data ?? {}));
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid import data" });
  }
  try {
    const currentSlice = dependencies.store.readFullSlice(body.accountId);
    const expectedSnapshot = buildImportSnapshotFingerprint(currentSlice);
    const result = await dependencies.executeImportWorker(
      { current: currentSlice, accountId: body.accountId, incoming, now: new Date().toISOString() },
      readCurrentRequestAbortSignal(),
    );
    if (result.imported === 0) {
      return reply.code(400).send({
        error: "The import contained no usable records, so the company data was left unchanged.",
        imported: 0,
        skipped: result.skipped,
        maxRecords: MAX_IMPORT_RECORDS,
      });
    }
    const auditRecord: AuditRecord = {
      ts: new Date().toISOString(),
      userId: user.id,
      accountId: body.accountId,
      action: "import",
      entity: "account",
      id: body.accountId,
      changedFields: [],
    };
    const auditOk = dependencies.commitProductAudit(reply, auditRecord, () => {
      if (buildImportSnapshotFingerprint(dependencies.store.readFullSlice(body.accountId)) !== expectedSnapshot) {
        throw new ImportSnapshotConflictError();
      }
      replaceAccountSlice(dependencies.db, body.accountId, buildCompleteAccountSlice(result.data));
    });
    return {
      imported: result.imported,
      skipped: result.skipped,
      maxRecords: MAX_IMPORT_RECORDS,
      auditWarning: !auditOk,
    };
  } catch (error) {
    return sendImportFailure(reply, error, dependencies);
  }
}

function handleReset(req: FastifyRequest, reply: FastifyReply, dependencies: ImportRouteDependencies): unknown {
  if (!dependencies.allowReset || dependencies.authMode !== "off") {
    return reply.code(403).send({ error: "reset disabled" });
  }
  tx(dependencies.db, () => {
    wipe(dependencies.db);
    if (isResetSeedRequested(req.body)) insertAll(dependencies.db, seed());
  });
  return { ok: true };
}

export function registerImportRoutes(app: FastifyInstance, dependencies: ImportRouteDependencies): void {
  // Bulk import into one account, reusing the SAME remap+validate+sanitize the store
  // runs (shared/domain/mutations.remapAndValidateImport). Body: { accountId, data }.
  // `data` may be a raw export ({schemaVersion,data} or bare AppData); parseData
  // applies the shape guard + MAX_IMPORT_RECORDS cap + migration.
  //
  // EXEMPT from the single-company cap: replaceAccountSlice only ever rewrites SCOPED tables
  // (accountId-carrying), never `accounts` itself — an import can only replace an EXISTING
  // account's data, never insert a new top-level accounts row. So there is no create vector here
  // for accountCreateCapped to gate.
  app.post("/api/import", (req, reply) => {
    // Import first requires 'purge', NOT 'write' (editor), because:
    //   (1) it is DESTRUCTIVE slice replacement — replaceAccountSlice deletes the account's
    //       entire scoped slice and re-inserts the import, the same hard-delete semantics the
    //       purge tier exists for (cf. the accounts-DELETE vectors); and
    //   (2) it BYPASSES field-level write pins — every id is remapped, so sanitizeWrite's
    //       existing-row pins (e.g. the P1.6 timeOff note pin) can never match a stored row.
    //       At 'write' tier a note-blind editor could erase every owner-confidential timeOff
    //       note (their own exports are note-redacted) or fabricate notes wholesale.
    // It is then narrowed to OWNER in auth-on mode: admins receive private clients/projects with
    // quoted cover names and no raw codeName. Their own valid export therefore cannot safely be
    // used as a replacement — it would turn the cover name into the persisted real name and repair
    // the missing code name to "Confidential", destroying the owner-only identity. OFF mode keeps
    // the open behaviour (demo/e2e parity — authorize no-ops there).
    // remapAndValidateImport drops/repairs dangling refs before SQLite. The handler retains
    // defence-in-depth so any residual constraint failure is classified by fail rather than lost.
    return handleImport(req, reply, dependencies);
  });

  // Test-only, trusted-local only: wipe (and optionally re-seed) so E2E/integration runs start
  // clean. An authenticated browser identity has tenant-scoped memberships, never installation-
  // wide erasure authority, so auth-on modes refuse this route even when allowReset was set.
  //
  // EXEMPT from the single-company cap: this is the raw insertAll test-only path (itself
  // production-forbidden — see bootGuard/resetForbidden, and allowReset just below), not an
  // HTTP create vector the cap is meant to police. It's how e2e fixtures reach a known
  // multi-company state (the demo seed ships TWO companies) without threading multiAccount
  // through every spec.
  app.post("/api/test/reset", (req, reply) => handleReset(req, reply, dependencies));
}
