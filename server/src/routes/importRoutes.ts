import type { AuthorizeBasicInput, ParseResult } from "./routeShared";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccountAdminPort } from "@capacitylens/shared/account/ports";
import type { AccountMemberResourcePort } from "@capacitylens/shared/account/ports";
import type { Role } from "@capacitylens/shared/account/types";
import { canSeePrivateNames } from "@capacitylens/shared/domain/access";
import { seed } from "@capacitylens/shared/data/seed";
import { parseData, MAX_IMPORT_RECORDS } from "@capacitylens/shared/data/transfer";
import { APP_DATA_KEYS, type AppData } from "@capacitylens/shared/types/entities";
import type { AuditRecord } from "../audit";
import type { AccountMode } from "../auth";
import type { KeyedOperationLock } from "../accounts/KeyedOperationLock";
import { buildCompleteAccountSlice, insertAll, replaceAccountSlice, wipe } from "../db";
import type { Db } from "../db";
import { readCurrentRequestAbortSignal } from "../requestAbort";
import type { runImportWorker } from "../runImportWorker";
import type { TenantStore } from "../tenantStore";
import { tx } from "../txn";
import { WorkQueueFullError } from "../workQueue";
import type { WriteRejection } from "../writePipeline";
import { REPLY_ERRORS } from "./replyErrors";

type AuthorizeImportInput = Omit<AuthorizeBasicInput, "action"> & { action: "purge" };

type ImportAccountAdministration = AccountAdminPort & {
  roleForPrincipalInWorkspace(principalId: string, workspaceId: string): Role | null;
};

class ImportSnapshotConflictError extends Error {
  constructor() {
    super(REPLY_ERRORS.importSnapshotStale);
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
  /** Retained for test/runtime dependency compatibility; replacement cleanup is owned by replaceAccountSlice. */
  memberResources: AccountMemberResourcePort;
  accountLock: KeyedOperationLock;
  authorize: (input: AuthorizeImportInput) => boolean;
  executeImportWorker: typeof runImportWorker;
  commitProductAudit: (reply: FastifyReply, record: AuditRecord, mutation: () => void) => boolean;
  fail: (reply: FastifyReply, error: unknown) => FastifyReply;
}

interface ImportRequestBody {
  accountId: string;
  data: unknown;
}

function parseImportRequestBody(body: unknown): ParseResult<ImportRequestBody, WriteRejection> {
  if (body === null || typeof body !== "object" || !("accountId" in body) || typeof body.accountId !== "string") {
    return { kind: "invalid", failure: { status: 400, error: REPLY_ERRORS.accountIdRequired } };
  }
  return { kind: "parsed", value: { accountId: body.accountId, data: "data" in body ? body.data : undefined } };
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

type ImportAuthorization =
  { kind: "allowed"; user: NonNullable<FastifyRequest["user"]> } | { kind: "refused"; reply: FastifyReply };

function authorizeImportUser({ req, reply, body, dependencies }: AuthorizedImportUserInput): ImportAuthorization {
  if (!dependencies.authorize({ req, reply, accountId: body.accountId, action: "purge" })) {
    return { kind: "refused", reply };
  }
  const user = req.user;
  if (user === null) {
    return { kind: "refused", reply: dependencies.fail(reply, new Error("Authenticated import request has no user.")) };
  }
  if (dependencies.authMode === "off") return { kind: "allowed", user };
  const role = dependencies.accountAdminPort.roleForPrincipalInWorkspace(user.id, body.accountId);
  if (role === null || !canSeePrivateNames(role)) {
    return { kind: "refused", reply: reply.code(403).send({ error: REPLY_ERRORS.importOwnerOnly }) };
  }
  return { kind: "allowed", user };
}

function sendImportFailure(reply: FastifyReply, error: unknown, dependencies: ImportRouteDependencies): FastifyReply {
  if (error instanceof WorkQueueFullError) {
    reply.header("retry-after", "1");
    return reply.code(503).send({ error: REPLY_ERRORS.importBusy, code: "IMPORT_BUSY", retryable: true });
  }
  if (error instanceof ImportSnapshotConflictError) {
    return reply.code(409).send({ error: REPLY_ERRORS.importSnapshotStale, code: "IMPORT_SNAPSHOT_STALE" });
  }
  return dependencies.fail(reply, error);
}

function hasCurrentImportAuthority(userId: string, accountId: string, dependencies: ImportRouteDependencies): boolean {
  if (dependencies.authMode === "off") return true;
  const role = dependencies.accountAdminPort.roleForPrincipalInWorkspace(userId, accountId);
  return role !== null && canSeePrivateNames(role);
}

function buildImportAuditRecord(userId: string, accountId: string): AuditRecord {
  return {
    ts: new Date().toISOString(),
    userId,
    accountId,
    action: "import",
    entity: "account",
    id: accountId,
    changedFields: [],
  };
}

/**
 * Recheck the uploaded data on the server. The browser runs the same parser before upload and
 * shows its specific reason; here the detail is logged and the caller receives one fixed message
 * rather than a thrown error's text.
 */
function parseImportData(req: FastifyRequest, data: unknown): ParseResult<ReturnType<typeof parseData>, string> {
  try {
    return { kind: "parsed", value: parseData(JSON.stringify(data ?? {})) };
  } catch (error) {
    req.log.warn({ err: error }, "Import data rejected");
    return { kind: "invalid", failure: REPLY_ERRORS.importDataInvalid };
  }
}

async function importState(
  req: FastifyRequest,
  reply: FastifyReply,
  dependencies: ImportRouteDependencies,
): Promise<FastifyReply> {
  const parsed = parseImportRequestBody(req.body);
  if (parsed.kind === "invalid") return reply.code(parsed.failure.status).send({ error: parsed.failure.error });
  const body = parsed.value;
  const authorization = authorizeImportUser({ req, reply, body, dependencies });
  if (authorization.kind === "refused") return authorization.reply;
  const { user } = authorization;
  const data = parseImportData(req, body.data);
  if (data.kind === "invalid") return reply.code(400).send({ error: data.failure });
  const incoming = data.value;
  try {
    const currentSlice = dependencies.store.readFullSlice(body.accountId);
    const expectedSnapshot = buildImportSnapshotFingerprint(currentSlice);
    const result = await dependencies.executeImportWorker(
      { current: currentSlice, accountId: body.accountId, incoming, now: new Date().toISOString() },
      readCurrentRequestAbortSignal(),
    );
    if (!hasCurrentImportAuthority(user.id, body.accountId, dependencies)) {
      return reply.code(403).send({ error: REPLY_ERRORS.importOwnerOnly });
    }
    if (result.imported === 0) {
      return reply.code(400).send({
        error: REPLY_ERRORS.importEmpty,
        imported: 0,
        skipped: result.skipped,
        maxRecords: MAX_IMPORT_RECORDS,
      });
    }
    const auditRecord = buildImportAuditRecord(user.id, body.accountId);
    const auditOk = await dependencies.accountLock.withKeys([user.id, `workspace:${body.accountId}`], () => {
      if (!hasCurrentImportAuthority(user.id, body.accountId, dependencies)) {
        return undefined;
      }
      return dependencies.commitProductAudit(reply, auditRecord, () => {
        if (buildImportSnapshotFingerprint(dependencies.store.readFullSlice(body.accountId)) !== expectedSnapshot) {
          throw new ImportSnapshotConflictError();
        }
        replaceAccountSlice(dependencies.db, body.accountId, buildCompleteAccountSlice(result.data));
      });
    });
    if (auditOk === undefined) {
      return reply.code(403).send({ error: REPLY_ERRORS.importOwnerOnly });
    }
    return reply.code(200).send({
      imported: result.imported,
      skipped: result.skipped,
      maxRecords: MAX_IMPORT_RECORDS,
      auditWarning: !auditOk,
    });
  } catch (error) {
    return sendImportFailure(reply, error, dependencies);
  }
}

function resetState(req: FastifyRequest, reply: FastifyReply, dependencies: ImportRouteDependencies): FastifyReply {
  if (!dependencies.allowReset || dependencies.authMode !== "off") {
    return reply.code(403).send({ error: REPLY_ERRORS.resetDisabled });
  }
  tx(dependencies.db, () => {
    wipe(dependencies.db);
    if (isResetSeedRequested(req.body)) insertAll(dependencies.db, seed());
  });
  return reply.code(200).send({ ok: true });
}

export function registerImportRoutes(app: FastifyInstance, dependencies: ImportRouteDependencies): void {
  // Bulk import into one account, reusing the same remap+validate+sanitize the store
  // runs (shared/domain/mutations.remapAndValidateImport). Body: { accountId, data }.
  // `data` may be a raw export ({schemaVersion,data} or bare AppData); parseData
  // applies the shape guard + MAX_IMPORT_RECORDS cap + migration.
  //
  // Exempt from the single-company cap: replaceAccountSlice only ever rewrites scoped tables
  // (accountId-carrying), never `accounts` itself. An import can only replace an existing
  // account's data, never insert a new top-level accounts row. So there is no create vector here
  // for accountCreateCapped to gate.
  app.post("/api/import", (req, reply) => {
    // Import first requires 'purge', not 'write' (editor), because:
    //   (1) it is destructive slice replacement, replaceAccountSlice deletes the account's
    //       entire scoped slice and re-inserts the import, the same hard-delete semantics the
    //       purge tier exists for (cf. the accounts-DELETE vectors); and
    //   (2) it bypasses field-level write pins. Every id is remapped, so sanitizeWrite's
    //       existing-row pins (e.g. the timeOff note pin) can never match a stored row.
    //       At 'write' tier a note-blind editor could erase every owner-confidential timeOff
    //       note (their own exports are note-redacted) or fabricate notes wholesale.
    // It is then narrowed to owner in auth-on mode: admins receive private clients/projects with
    // quoted cover names and no raw codeName. Their own valid export therefore cannot safely be
    // used as a replacement. It would turn the cover name into the persisted real name and repair
    // the missing code name to "Confidential", destroying the owner-only identity. Off mode keeps
    // the open behaviour (demo/e2e parity, authorize no-ops there).
    // remapAndValidateImport drops/repairs dangling refs before SQLite. The handler retains
    // defence-in-depth so any residual constraint failure is classified by fail rather than lost.
    return importState(req, reply, dependencies);
  });

  // Test-only, trusted-local only: wipe (and optionally re-seed) so E2E/integration runs start
  // clean. An authenticated browser identity has tenant-scoped memberships, never installation-
  // wide erasure authority, so auth-on modes refuse this route even when allowReset was set.
  //
  // Exempt from the single-company cap: this is the raw insertAll test-only path (itself
  // production-forbidden: see bootGuard/resetForbidden, and allowReset just below), not an
  // HTTP create vector the cap is meant to police. It's how e2e fixtures reach a known
  // multi-company state (the demo seed ships two companies) without threading multiAccount
  // through every spec.
  app.post("/api/test/reset", (req, reply) => resetState(req, reply, dependencies));
}
