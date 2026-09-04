import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Action } from "@capacitylens/shared/domain/access";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AuditRecord } from "../audit";
import type { AuthMode } from "../auth";
import { deleteRow, getRow, insertRow, type Db, type RewrittenAllocationRevision, upsertRow } from "../db";
import type { SanitizeWriteOptions } from "../fieldPolicy";
import type { TenantStore } from "../tenantStore";
import { appliedRequestedFieldNames, sanitizeWrite, validateWrite } from "../validate";
import {
  builtinInternalWriteGuard,
  checkEntityWriteBody,
  prepareScopedWrite,
  replaceGeneratedBuiltin,
  stampServerRevision,
} from "../writePipeline";
import {
  isGenericEntity,
  isLifecycleEntity,
  isScopedTable,
  isStaleWrite,
  ownsRow,
  shapeActivityWriteEcho,
  writeActivityRow,
} from "./routeShared";

export interface EntityRouteDependencies {
  db: Db;
  store: TenantStore;
  authMode: AuthMode;
  optimisticConcurrency: boolean;
  authorize: (
    req: FastifyRequest,
    reply: FastifyReply,
    accountId: string,
    action: Action,
    options?: { concealNonMembership?: boolean },
  ) => boolean;
  fieldVisibility: (req: FastifyRequest, table: string, accountId: unknown) => SanitizeWriteOptions;
  redact: (table: string, row: Record<string, unknown>, vis: SanitizeWriteOptions) => Record<string, unknown>;
  commitProductAudit: (reply: FastifyReply, record: AuditRecord, mutation: () => void) => boolean;
  fail: (reply: FastifyReply, error: unknown) => FastifyReply;
}

/** Stamp `ts` and assemble the 7-field AuditRecord shared by the generic handlers. */
function buildAuditRecord(
  userId: string,
  accountId: string,
  action: AuditRecord["action"],
  entity: string,
  id: string,
  changedFields: string[],
): AuditRecord {
  return { ts: new Date().toISOString(), userId, accountId, action, entity, id, changedFields };
}

export function registerEntityRoutes(app: FastifyInstance, dependencies: EntityRouteDependencies): void {
  const {
    db,
    store,
    authMode,
    optimisticConcurrency,
    authorize,
    fieldVisibility: fieldVisibilityFor,
    redact: redactWriteEcho,
    commitProductAudit,
    fail: sendFail,
  } = dependencies;

  // Generic scoped-entity creation. `accounts` is served by the dedicated routes above.
  app.post("/api/:entity", (req, reply) => {
    const { entity } = req.params as { entity: string };
    if (!isGenericEntity(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` });
    // Shared body-shape + builtin-Internal guard (Finding 7 funnel). A missing/non-object body
    // would otherwise null-deref below (accountId! / sanitizeWrite's assertIdPresent) BEFORE the
    // try block could classify it — a misclassified 500. checkEntityWriteBody rejects it with the
    // same shape /api/batch and /api/import use.
    const scoped = isScopedTable(entity);
    const bodyCheck = checkEntityWriteBody("create", entity, req.body, undefined, scoped);
    if (bodyCheck) return reply.code(bodyCheck.status).send({ error: bodyCheck.error });
    const requestRow = req.body as Record<string, unknown>;
    const builtinCheck = builtinInternalWriteGuard("create", entity, undefined, requestRow);
    if (builtinCheck) return reply.code(builtinCheck.status).send({ error: builtinCheck.error });
    // P1.5 write gate (scoped tables only).
    if (scoped) {
      if (!authorize(req, reply, requestRow.accountId as string, "write")) return;
    }
    try {
      // P1.6: a note-blind writer CREATING time off gets its `note` stripped (nothing stored
      // to preserve; they could never read back a note they authored) — see sanitizeWrite.
      const vis = fieldVisibilityFor(req, entity, requestRow.accountId);
      // Finding 7/9 funnel: sanitize + stamp + ACCOUNT-SCOPED read + validate in one place (was an
      // inline sanitize/stamp + a full-DB loadState here).
      const { row } = prepareScopedWrite({
        store,
        entity,
        body: requestRow,
        existing: undefined,
        vis,
        verb: "create",
      });
      const auditRecord = buildAuditRecord(
        req.user!.id,
        (row.accountId as string | undefined) ?? (row.id as string),
        "create",
        entity,
        row.id as string,
        appliedRequestedFieldNames(entity, requestRow, undefined, row),
      );
      commitProductAudit(reply, auditRecord, () => {
        insertRow(db, entity, row);
      });
      return reply.code(201).send(row);
    } catch (err) {
      return sendFail(reply, err);
    }
  });

  // Idempotent upsert by id — the verb the client sync adapter uses for every
  // create AND update, so a replayed batch (after a partial failure) is safe. The
  // body's id must match the URL id.
  app.put("/api/:entity/:id", (req, reply) => {
    const { entity, id } = req.params as { entity: string; id: string };
    if (!isGenericEntity(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` });
    const scoped = isScopedTable(entity);
    const bodyCheck = checkEntityWriteBody("replace", entity, req.body, id, scoped);
    if (bodyCheck) return reply.code(bodyCheck.status).send({ error: bodyCheck.error });
    const body = req.body as Record<string, unknown>;
    // P1.5 write gate (scoped tables): membership + write tier for the body's accountId. The
    // ownsRow immutability guard below still runs — authorize gates WHO may write, ownsRow keeps
    // accountId immutable.
    if (scoped && !authorize(req, reply, body.accountId as string, "write")) return;
    try {
      const existing = getRow(db, entity, id);
      const builtinCheck = builtinInternalWriteGuard("replace", entity, existing, body);
      if (builtinCheck) return reply.code(builtinCheck.status).send({ error: builtinCheck.error });
      // Ordinary Editors may manage clients, but changing the server-owned Internal singleton's
      // identity also rewrites every referencing project. Preserve the documented legacy-id
      // adoption path while requiring a fresh Admin/Owner session for that privileged migration.
      if (
        entity === "clients" &&
        body.builtin === true &&
        existing?.builtin !== true &&
        !authorize(req, reply, body.accountId as string, "manageInternalClient")
      )
        return;
      // accountId is immutable: a write must not move an EXISTING row to another account
      // (see ownsRow). The web store enforces this via findOwned; without the same guard a
      // crafted request could re-home a row and orphan its children across the tenant boundary.
      if (!ownsRow(existing, body.accountId)) {
        return reply.code(404).send({ error: "Not found" });
      }
      // P1.6: the note-visibility fact for this writer — used to PIN the time-off `note` on the
      // write (their round-tripped row was redacted, so a bare upsert would NULL a note they
      // never saw — see sanitizeWrite) AND to redact the note from everything echoed back below,
      // the 409 conflict payload included.
      const vis = fieldVisibilityFor(req, entity, body.accountId);
      // Optimistic concurrency (opt-in): refuse to overwrite a strictly newer row — the
      // predicate is isStaleWrite, SHARED with the batch loop so the two paths can't drift.
      // The 409's `current` payload is a READ of the stored row, so it gets the same note
      // redaction as the write echo — the conflict path must not hand a note-blind writer
      // the redacted field.
      if (optimisticConcurrency && isStaleWrite(existing, body)) {
        return reply.code(409).send({
          error: "The record was modified more recently on the server.",
          current: redactWriteEcho(entity, existing, vis),
        });
      }
      // Finding 7/9 funnel: sanitize + stamp + ACCOUNT-SCOPED read + validate in one place (was an
      // inline sanitize/stamp + a full-DB loadState here). A generated-builtin replacement defers
      // its validation (see prepareScopedWrite); every other write is validated there.
      const { row, generatedReplacement, scopedState } = prepareScopedWrite({
        store,
        entity,
        body,
        existing,
        vis,
        verb: "replace",
      });
      const auditRecord = buildAuditRecord(
        req.user!.id,
        (body.accountId as string | undefined) ?? id,
        existing ? "update" : "create",
        entity,
        id,
        appliedRequestedFieldNames(entity, body, existing, row),
      );
      let rewrittenAllocations: RewrittenAllocationRevision[] = [];
      commitProductAudit(reply, auditRecord, () => {
        if (generatedReplacement) {
          replaceGeneratedBuiltin(db, scopedState, generatedReplacement, row);
        } else if (entity === "activities") {
          rewrittenAllocations = writeActivityRow(db, undefined, row, existing);
        } else {
          // Validation already ran in the funnel above.
          upsertRow(db, entity, row);
        }
      });
      // A write response is a read: apply the same note/private-name projections as /api/state.
      const echo = redactWriteEcho(entity, row, vis);
      return reply.code(200).send(shapeActivityWriteEcho(entity, echo, rewrittenAllocations));
    } catch (err) {
      return sendFail(reply, err);
    }
  });

  // True partial patch: merge the body over the stored row, then sanitize + validate
  // the MERGED entity before writing. (A blind column-wise update would null every
  // field the body omits.) 404 when the row doesn't exist.
  app.patch("/api/:entity/:id", (req, reply) => {
    const { entity, id } = req.params as { entity: string; id: string };
    if (!isGenericEntity(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` });
    // Shared body-shape check (Finding 7 funnel). A missing/non-object body would otherwise
    // null-deref inside sanitizeWrite's merge, a misclassified 500. For PATCH accountId is
    // OPTIONAL — only a PRESENT non-string is rejected.
    const scoped = isScopedTable(entity);
    const bodyCheck = checkEntityWriteBody("patch", entity, req.body, id, scoped);
    if (bodyCheck) return reply.code(bodyCheck.status).send({ error: bodyCheck.error });
    try {
      const existing = getRow(db, entity, id);
      if (!existing) return reply.code(404).send({ error: "Not found" });
      // A scoped PATCH has no required account assertion in its partial body. Authorize against
      // the stored owner, but conceal non-membership as the same 404 used for an absent id. Run
      // row-specific guards only after that boundary so a foreign built-in row is not an oracle.
      if (
        scoped &&
        !authorize(req, reply, existing.accountId as string, "write", {
          concealNonMembership: true,
        })
      )
        return;
      const builtinCheck = builtinInternalWriteGuard("patch", entity, existing, req.body as Record<string, unknown>);
      if (builtinCheck) return reply.code(builtinCheck.status).send({ error: builtinCheck.error });
      // P1.6 note pin (see sanitizeWrite): the merge already carries the STORED note (a note-blind
      // caller's PATCH body can't include one they never received), but the pin also stops a
      // crafted note change/clear riding a patch. accountId for the role lookup = the body's
      // override if present (then refused by ownsRow below), else the stored row's.
      const vis = fieldVisibilityFor(
        req,
        entity,
        (req.body as { accountId?: unknown }).accountId ?? existing.accountId,
      );
      const merged = sanitizeWrite(
        entity,
        { ...existing, ...(req.body as Record<string, unknown>), id },
        existing,
        vis,
      );
      // accountId is immutable — a patch must not re-home the row to another company (ownsRow).
      if (!ownsRow(existing, merged.accountId)) {
        return reply.code(404).send({ error: "Not found" });
      }
      if (optimisticConcurrency && isStaleWrite(existing, req.body as Record<string, unknown>, false)) {
        return reply.code(409).send({
          error: "The record was modified more recently on the server.",
          current: redactWriteEcho(entity, existing, vis),
        });
      }
      const stamped = stampServerRevision(merged, existing);
      // PATCH already authorized the stored owner and proved accountId immutable above. SQLite's
      // validation lookup resolves only the row/FK/dependent coordinates this write needs; custom
      // stores retain the complete-slice fallback. Client replacement still needs the full client
      // set for its singleton/reparent rule.
      const scopeId = String(merged.accountId);
      const lookup = store.validationLookup?.();
      const validationState =
        entity === "clients" || lookup === undefined ? store.readFullSlice(scopeId) : emptyAppData();
      validateWrite(validationState, entity, stamped, existing, lookup);
      // Record only requested keys whose sanitized, pinned result actually differs from storage.
      let rewrittenAllocations: RewrittenAllocationRevision[] = [];
      commitProductAudit(
        reply,
        buildAuditRecord(
          req.user!.id,
          (merged.accountId as string | undefined) ?? id,
          "patch",
          entity,
          id,
          appliedRequestedFieldNames(entity, req.body, existing, stamped),
        ),
        () => {
          if (entity === "activities") {
            rewrittenAllocations = writeActivityRow(db, undefined, stamped, existing);
          } else {
            upsertRow(db, entity, stamped);
          }
        },
      );
      // The merge carries stored protected fields into `merged`; apply the normal read projection.
      const echo = redactWriteEcho(entity, stamped, vis);
      return reply.code(200).send(shapeActivityWriteEcho(entity, echo, rewrittenAllocations));
    } catch (err) {
      return sendFail(reply, err);
    }
  });

  app.delete("/api/:entity/:id", (req, reply) => {
    const { entity, id } = req.params as { entity: string; id: string };
    if (!isGenericEntity(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` });
    if (isLifecycleEntity(entity)) {
      return reply.code(400).send({
        error: "Use the dedicated lifecycle endpoints for this entity.",
      });
    }
    // Scope a scoped-table delete to its owning account — the server analog of the
    // client's MANDATORY findOwned guard. A scoped delete MUST assert an owning account:
    // omitting it can't prove ownership, so we refuse with 400 (rather than deleting by id,
    // which was a tenant-guard bypass). A wrong owner is 404. (A company hard-delete is a TENANT
    // ERASURE, not a bare row delete — it has its own DELETE /api/accounts/:id route.)
    const { accountId } = req.query as { accountId?: string };
    try {
      if (!isScopedTable(entity)) {
        return reply.code(403).send({
          error: "No deletion policy is defined for this entity.",
        });
      }
      if (accountId === undefined) {
        return reply.code(400).send({
          error: "accountId is required to delete a scoped record.",
        });
      }
      // Resolve authority from the caller-asserted tenant before reading the candidate row. A
      // non-member therefore receives the same 403 for absent and foreign ids; an authorized
      // member receives the same 404 for either. OFF mode retains its historical idempotent 204.
      if (!authorize(req, reply, accountId, "write")) return;
      const existing = getRow(db, entity, id);
      if (!ownsRow(existing, accountId) || (!existing && authMode !== "off")) {
        return reply.code(404).send({ error: "Not found" });
      }
      if (existing) {
        commitProductAudit(reply, buildAuditRecord(req.user!.id, accountId, "delete", entity, id, []), () =>
          deleteRow(db, entity, id),
        );
      }
      return reply.code(204).send();
    } catch (err) {
      return sendFail(reply, err);
    }
  });
}
