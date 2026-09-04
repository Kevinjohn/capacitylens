import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuditRecord } from "../../audit";
import { getRow, insertRow } from "../../db";
import { appliedRequestedFieldNames, validateWrite } from "../../validate";
import { checkEntityWriteBody, prepareScopedWrite } from "../../writePipeline";

import type { AccountEntityRouteDependencies } from "./dependencies";
import { accountRouteFailure } from "./guards";
import { ACCOUNT_CREATE_CLOSED_MESSAGE, canonicalAccountProductPayload } from "./policy";

export function createAccountLifecycleHandlers(dependencies: AccountEntityRouteDependencies) {
  const {
    db,
    store,
    authMode,
    multiAccount,
    flows,
    authorize,
    command,
    replayCommand,
    fieldVisibility,
    drainProductAudit,
    enqueueAudit,
  } = dependencies;

  // Create a company. CLOSED when auth is on (→ POST /api/orgs, which also mints the Internal
  // client and the owner membership atomically); OPEN in trusted-local OFF mode, still BOUNDED by
  // the single-company cap inside AccountFlows.
  const post = async (req: FastifyRequest, reply: FastifyReply) => {
    // Shared body-shape guard (the Finding 7 funnel). A missing/non-object body would otherwise
    // null-deref in sanitizeWrite's assertIdPresent BEFORE the try block could classify it — a
    // misclassified 500. `accounts` is unscoped, so no accountId is required.
    const bodyCheck = checkEntityWriteBody("create", "accounts", req.body, undefined, false);
    if (bodyCheck) return reply.code(bodyCheck.status).send({ error: bodyCheck.error });
    if (authMode !== "off") {
      return reply.code(403).send({ error: ACCOUNT_CREATE_CLOSED_MESSAGE });
    }
    const requestRow = req.body as Record<string, unknown>;
    try {
      const vis = fieldVisibility(req, "accounts", requestRow.accountId);
      const { row, scopedState } = prepareScopedWrite({
        store,
        entity: "accounts",
        body: requestRow,
        existing: undefined,
        vis,
        verb: "create",
      });
      const auditRecord: AuditRecord = {
        ts: new Date().toISOString(),
        userId: req.user!.id,
        accountId: (row.accountId as string | undefined) ?? (row.id as string),
        action: "create",
        entity: "accounts",
        id: row.id as string,
        changedFields: appliedRequestedFieldNames("accounts", requestRow, undefined, row),
      };
      // A company is not usable without its singleton Internal client. Commit both rows as one unit
      // so a constraint/storage failure cannot leave a degraded company behind.
      const provisioned = await flows.provisionWorkspace({
        actor: req.accountActor!,
        workspaceId: row.id as string,
        joinedAt: row.createdAt as string,
        command: command(req),
        multiWorkspace: multiAccount,
        bootstrapAuthorized: false,
        canonicalProductPayload: canonicalAccountProductPayload(row),
        provisionProductData: () => {
          // Run validation only on first execution, inside the same transaction as the insert. A
          // committed command replay must not be rejected merely because the account now exists or
          // the single-company cap became full after its original success. Reuses the funnel's
          // scoped slice (Finding 9 — accounts validation is name-only, so a second full-DB
          // loadState here would be pure waste).
          validateWrite(scopedState, "accounts", row);
          insertRow(db, "accounts", row);
          insertRow(
            db,
            "clients",
            buildInternalClient(row.id as string, row.createdAt as string) as unknown as Record<string, unknown>,
          );
          enqueueAudit(auditRecord);
          return row;
        },
      });
      if (!provisioned.replayed) drainProductAudit(reply);
      return reply.code(201).send(provisioned.product as Record<string, unknown>);
    } catch (err) {
      return accountRouteFailure(reply, err, dependencies);
    }
  };

  // Hard-delete a company. This is a TENANT ERASURE, not a bare row delete: dropping an `accounts`
  // row CASCADES (FK ON DELETE CASCADE) and wipes ALL the account's scoped data, so AccountFlows
  // coordinates the product cascade, administration sweep and orphaned local-identity erasure in one
  // transaction.
  const deleteAccount = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      const targetExisted = Boolean(getRow(db, "accounts", id));
      // The completed erasure receipt is deliberately retained after membership removal. An exact
      // authenticated retry may replay that receipt before the ordinary live-membership gate; absent,
      // malformed, pending or unrelated commands still take the Owner path.
      const replay = replayCommand(req);
      if (replay) {
        const replayed = await flows.replayWorkspaceErasure({
          actor: req.accountActor!,
          workspaceId: id,
          command: replay,
        });
        if (replayed) return reply.code(204).send();
      }
      // P1.5 account hard-delete gate. The account-lifecycle CREATE exemption (a new auth-on user
      // must mint their first account before any membership exists) does NOT extend to DELETE: this
      // is total tenant destruction, intentionally stricter than purging one tombstoned record —
      // only an owner may erase the tenant and orphaned member identities. OFF mode short-circuits
      // to allow so the default deploy can still delete companies.
      if (!authorize(req, reply, id, "deleteAccount")) return;
      // Preserve the auth-off API's established idempotent-delete contract. The coordinated erasure
      // path deliberately requires a real workspace so authenticated callers cannot use it as an
      // existence oracle, but trusted-local deletion historically returned 204 for an absent account.
      if (!targetExisted && authMode === "off") return reply.code(204).send();
      const auditRecord: AuditRecord = {
        ts: new Date().toISOString(),
        userId: req.user!.id,
        accountId: id, // attribution is the erased account itself, never a caller-supplied query value
        action: "delete",
        entity: "accounts",
        id,
        changedFields: [],
      };
      await flows.eraseWorkspace({
        actor: req.accountActor!,
        workspaceId: id,
        command: command(req),
        auditProductMutationInTx: targetExisted ? () => enqueueAudit(auditRecord) : undefined,
      });
      if (targetExisted) drainProductAudit(reply);
      return reply.code(204).send();
    } catch (err) {
      return accountRouteFailure(reply, err, dependencies);
    }
  };
  return { post, delete: deleteAccount };
}
