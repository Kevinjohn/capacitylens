import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccountAdminPort } from "@capacitylens/shared/account/ports";
import type { Role } from "@capacitylens/shared/account/types";
import { canSeePrivateNames } from "@capacitylens/shared/domain/access";
import { seed } from "@capacitylens/shared/data/seed";
import { parseData, MAX_IMPORT_RECORDS } from "@capacitylens/shared/data/transfer";
import { APP_DATA_KEYS, type AppData } from "@capacitylens/shared/types/entities";
import type { AuditRecord } from "../audit";
import type { AuthMode } from "../auth";
import { insertAll, replaceAccountSlice, type Db, validatedCompleteAccountSlice, wipe } from "../db";
import { currentRequestAbortSignal } from "../requestAbort";
import type { runImportWorker } from "../runImportWorker";
import type { TenantStore } from "../tenantStore";
import { tx } from "../txn";
import { WorkQueueFullError } from "../workQueue";

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

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}

/** Fingerprint only the scoped rows an import replaces. Row and field ordering are normalized so
 * equivalent SQLite reads compare equal while any accepted tenant mutation changes the token. */
function importSnapshotFingerprint(slice: AppData): string {
  const scoped = Object.fromEntries(
    APP_DATA_KEYS.filter((table) => table !== "accounts").map((table) => [
      table,
      [...slice[table]].sort((left, right) => left.id.localeCompare(right.id)),
    ]),
  );
  return createHash("sha256").update(canonicalJson(scoped)).digest("base64url");
}

export interface ImportRouteDependencies {
  db: Db;
  store: TenantStore;
  authMode: AuthMode;
  allowReset: boolean;
  accountAdminPort: ImportAccountAdministration;
  authorize: (req: FastifyRequest, reply: FastifyReply, accountId: string, action: "purge") => boolean;
  executeImportWorker: typeof runImportWorker;
  commitProductAudit: (reply: FastifyReply, record: AuditRecord, mutation: () => void) => boolean;
  fail: (reply: FastifyReply, error: unknown) => FastifyReply;
}

export function registerImportRoutes(app: FastifyInstance, dependencies: ImportRouteDependencies): void {
  const {
    db,
    store,
    authMode,
    allowReset,
    accountAdminPort,
    authorize,
    executeImportWorker,
    commitProductAudit,
    fail: sendFail,
  } = dependencies;

  // Bulk import into one account, reusing the SAME remap+validate+sanitize the store
  // runs (shared/domain/mutations.remapAndValidateImport). Body: { accountId, data }.
  // `data` may be a raw export ({schemaVersion,data} or bare AppData); parseData
  // applies the shape guard + MAX_IMPORT_RECORDS cap + migration.
  //
  // EXEMPT from the single-company cap: replaceAccountSlice only ever rewrites SCOPED tables
  // (accountId-carrying), never `accounts` itself — an import can only replace an EXISTING
  // account's data, never insert a new top-level accounts row. So there is no create vector here
  // for accountCreateCapped to gate.
  app.post("/api/import", async (req, reply) => {
    const body = req.body as { accountId?: string; data?: unknown };
    if (!body || typeof body.accountId !== "string") {
      return reply.code(400).send({ error: "accountId is required" });
    }
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
    if (!authorize(req, reply, body.accountId, "purge")) return;
    if (authMode !== "off") {
      const role = accountAdminPort.roleForPrincipalInWorkspace(req.user!.id, body.accountId);
      if (role === null || !canSeePrivateNames(role)) {
        return reply.code(403).send({ error: "Only the account owner can import data." });
      }
    }
    let incoming;
    try {
      incoming = parseData(JSON.stringify(body.data ?? {}));
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : "Invalid import data",
      });
    }
    // remapAndValidateImport drops/repairs dangling refs so the slice is FK-clean
    // before it hits SQLite; the try/catch is defence-in-depth so any residual DB
    // constraint failure becomes a 400 (via fail's classification) rather than an
    // uncaught 500.
    try {
      const currentSlice = store.readFullSlice(body.accountId);
      const expectedSnapshot = importSnapshotFingerprint(currentSlice);
      const result = await executeImportWorker(
        {
          current: currentSlice,
          accountId: body.accountId,
          incoming,
          now: new Date().toISOString(),
        },
        currentRequestAbortSignal(),
      );
      // Refuse a zero-record import rather than wiping the account's slice (mirrors the
      // client store guard — replacing a company's data with nothing is never intended).
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
        userId: req.user!.id,
        accountId: body.accountId,
        action: "import",
        entity: "account",
        id: body.accountId,
        changedFields: [],
      };
      const auditOk = commitProductAudit(reply, auditRecord, () => {
        // The worker runs outside SQLite so ordinary writes stay responsive. Recheck the exact
        // tenant slice after BEGIN IMMEDIATE and before replacement: a same-account commit in the
        // worker window must conflict, never be silently erased by this destructive import.
        if (importSnapshotFingerprint(store.readFullSlice(body.accountId!)) !== expectedSnapshot) {
          throw new ImportSnapshotConflictError();
        }
        replaceAccountSlice(db, body.accountId!, validatedCompleteAccountSlice(result.data));
      });
      return {
        imported: result.imported,
        skipped: result.skipped,
        maxRecords: MAX_IMPORT_RECORDS,
        auditWarning: !auditOk,
      };
    } catch (err) {
      if (err instanceof WorkQueueFullError) {
        reply.header("retry-after", "1");
        return reply.code(503).send({ error: err.message, code: "IMPORT_BUSY", retryable: true });
      }
      if (err instanceof ImportSnapshotConflictError) {
        return reply.code(409).send({
          error: err.message,
          code: "IMPORT_SNAPSHOT_STALE",
        });
      }
      return sendFail(reply, err);
    }
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
  app.post("/api/test/reset", (req, reply) => {
    if (!allowReset || authMode !== "off") {
      return reply.code(403).send({ error: "reset disabled" });
    }
    const body = (req.body ?? {}) as { seed?: boolean };
    tx(db, () => {
      wipe(db);
      if (body.seed) insertAll(db, seed());
    });
    return { ok: true };
  });
}
