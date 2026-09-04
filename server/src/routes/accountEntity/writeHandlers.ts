import { SINGLE_COMPANY_CAP_MESSAGE } from "@capacitylens/shared/account/policy";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuditRecord } from "../../audit";
import { getRow, upsertRow } from "../../db";
import { appliedRequestedFieldNames, sanitizeWrite, validateWrite } from "../../validate";
import { checkEntityWriteBody, prepareScopedWrite, stampServerRevision } from "../../writePipeline";

import type { AccountEntityRouteDependencies } from "./dependencies";
import { accountRouteFailure, accountWriteGuards } from "./guards";
import { ACCOUNT_CREATE_CLOSED_MESSAGE, accountCreateCapped, canonicalAccountProductPayload } from "./policy";

export function createAccountWriteHandlers(dependencies: AccountEntityRouteDependencies) {
  const {
    db,
    store,
    authMode,
    multiAccount,
    optimisticConcurrency,
    flows,
    authorize,
    command,
    fieldVisibility,
    redact,
    commitProductAudit,
    drainProductAudit,
    ownsRow,
    isStaleWrite,
    enqueueAudit,
  } = dependencies;

  // Idempotent upsert by id — the verb the client sync adapter uses for every create AND update, so
  // a replayed batch (after a partial failure) is safe. The body's id must match the URL id.
  const put = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const bodyCheck = checkEntityWriteBody("replace", "accounts", req.body, id, false);
    if (bodyCheck) return reply.code(bodyCheck.status).send({ error: bodyCheck.error });
    const body = req.body as Record<string, unknown>;
    try {
      const workspaceCommand = command(req);
      const existing = getRow(db, "accounts", id);
      // Account CREATE via upsert (no row at this id yet) is CLOSED when auth is on. Checked FIRST
      // so the auth-on caller always gets the actionable "use /api/orgs" direction.
      if (!existing && authMode !== "off") {
        return reply.code(403).send({ error: ACCOUNT_CREATE_CLOSED_MESSAGE });
      }
      // Single-company cap (create-time only; OFF mode only here — the auth-on create was already
      // refused just above). Checked BEFORE the account-write gate below (which only ever fires for
      // the UPDATE case) so the two never overlap. An UPDATE is NEVER capped.
      if (!existing && accountCreateCapped(db, multiAccount)) {
        return reply.code(403).send({ error: SINGLE_COMPANY_CAP_MESSAGE });
      }
      // P1.5 account-write gate. `accounts` is not scoped, so there is no body accountId to gate on:
      // an UPDATE requires membership + write tier for the account's OWN id, mirroring the DELETE
      // route. A CREATE is OPEN only in OFF mode (both refusals above). OFF: authorize no-ops.
      if (existing && !authorize(req, reply, id, "write")) return;
      // accountId is immutable (ownsRow). An `accounts` row stores no accountId, so this refuses a
      // body that asserts ownership by another company rather than silently ignoring the claim.
      // Compare the sanitised candidate so malformed frozen values are ignored and an absent legacy
      // value may be set once. A different valid value remains a 409. (Guard sequence shared with
      // PATCH — see accountWriteGuards; the stale-write guard runs separately below, after the
      // trusted-local replay attempt it must not preempt.)
      if (
        accountWriteGuards({
          reply,
          existing,
          ownsRow,
          isStaleWrite,
          redact,
          checkOwnsRow: { accountId: body.accountId },
          checkFrozen: { candidate: sanitizeWrite("accounts", body, existing) },
        })
      )
        return;
      const vis = fieldVisibility(req, "accounts", body.accountId);
      // Only trusted-local compatibility creates can arrive here as a completed provisioning replay.
      // Authenticated account creation is closed on this route, so awaiting the coordinator during an
      // ordinary authenticated update would introduce a yield between the role decision above and the
      // write below (allowing a concurrent removal to stale-authorize the update for no replay benefit).
      if (authMode === "off" && existing) {
        const replay = await flows.replayWorkspaceProvisioning<Record<string, unknown>>({
          actor: req.accountActor!,
          workspaceId: id,
          command: workspaceCommand,
          canonicalProductPayload: canonicalAccountProductPayload(sanitizeWrite("accounts", body, existing, vis)),
        });
        if (replay) return reply.code(200).send(redact("accounts", replay.product, vis));
      }
      // Optimistic concurrency (opt-in): refuse to overwrite a strictly newer row — the predicate is
      // isStaleWrite, SHARED with the batch loop so the two paths can't drift. (Guard sequence
      // shared with PATCH — see accountWriteGuards.)
      if (
        accountWriteGuards({
          reply,
          existing,
          ownsRow,
          isStaleWrite,
          redact,
          checkStale: { optimisticConcurrency, candidateRow: body, vis },
        })
      )
        return;
      // Finding 7/9 funnel: sanitize + stamp + account-scoped read + validate in one place. An
      // accounts CREATE defers its validation into the provisioning closure (see prepareScopedWrite);
      // an accounts UPDATE is validated here.
      const { row, scopedState } = prepareScopedWrite({
        store,
        entity: "accounts",
        body,
        existing,
        vis,
        verb: "replace",
      });
      const auditRecord: AuditRecord = {
        ts: new Date().toISOString(),
        userId: req.user!.id,
        // Attribution is the MUTATED account's own id. A caller-supplied body accountId is an
        // assertion the ownsRow guard may reject; it must never decide which tenant's ledger
        // records this mutation.
        accountId: id,
        action: existing ? "update" : "create",
        entity: "accounts",
        id,
        changedFields: appliedRequestedFieldNames("accounts", body, existing, row),
      };
      let responseRow = row;
      if (!existing) {
        // A company is not usable without its singleton Internal client — one unit, as on POST.
        const provisioned = await flows.provisionWorkspace({
          actor: req.accountActor!,
          workspaceId: id,
          joinedAt: row.createdAt as string,
          command: workspaceCommand,
          multiWorkspace: multiAccount,
          bootstrapAuthorized: false,
          canonicalProductPayload: canonicalAccountProductPayload(row),
          provisionProductData: () => {
            validateWrite(scopedState, "accounts", row, existing);
            upsertRow(db, "accounts", row);
            upsertRow(
              db,
              "clients",
              buildInternalClient(id, row.createdAt as string) as unknown as Record<string, unknown>,
            );
            enqueueAudit(auditRecord);
            return row;
          },
        });
        responseRow = provisioned.product as Record<string, unknown>;
        if (!provisioned.replayed) drainProductAudit(reply);
      } else {
        commitProductAudit(reply, auditRecord, () => {
          // Validation already ran in the funnel above.
          upsertRow(db, "accounts", row);
        });
      }
      // A write response is a read: apply the same projections as /api/state.
      return reply.code(200).send(redact("accounts", responseRow, vis));
    } catch (err) {
      return accountRouteFailure(reply, err, dependencies);
    }
  };

  // True partial patch: merge the body over the stored row, then sanitize + validate the MERGED
  // entity before writing. (A blind column-wise update would null every field the body omits.)
  // 404 when the row doesn't exist — a PATCH is therefore always an UPDATE, never a create.
  const patch = (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const bodyCheck = checkEntityWriteBody("patch", "accounts", req.body, id, false);
    if (bodyCheck) return reply.code(bodyCheck.status).send({ error: bodyCheck.error });
    try {
      const existing = getRow(db, "accounts", id);
      if (!existing) return reply.code(404).send({ error: "Not found" });
      // P1.5 account-write gate (see the PUT route): always an UPDATE, so always membership + write
      // tier for the account's own id. OFF: no-op allow.
      if (!authorize(req, reply, id, "write")) return;
      const assertedAccountId = (req.body as { accountId?: unknown }).accountId;
      const vis = fieldVisibility(req, "accounts", assertedAccountId ?? existing.accountId);
      const merged = sanitizeWrite(
        "accounts",
        { ...existing, ...(req.body as Record<string, unknown>), id },
        existing,
        vis,
      );
      // accountId is immutable (ownsRow). `accounts` is unscoped, so sanitisation drops any
      // asserted accountId from `merged`; like PUT, the ownsRow guard receives the CALLER's raw
      // assertion so a claim on another company is REJECTED (404) rather than silently ignored.
      // `merged` already pins stored frozen values when malformed input is dropped: missing legacy
      // values may be set once, different valid stored values stay frozen. Guard sequence shared
      // with PUT — see accountWriteGuards.
      if (
        accountWriteGuards({
          reply,
          existing,
          ownsRow,
          isStaleWrite,
          redact,
          checkOwnsRow: { accountId: assertedAccountId ?? existing.accountId },
          checkFrozen: { candidate: merged },
          checkStale: {
            optimisticConcurrency,
            candidateRow: req.body as Record<string, unknown>,
            requirePrecondition: false,
            vis,
          },
        })
      )
        return;
      const stamped = stampServerRevision(merged, existing);
      // SQLite's validation lookup resolves only the row/FK/dependent coordinates this write needs;
      // custom stores retain the complete-slice fallback. An account keys its own slice by id.
      const lookup = store.validationLookup?.();
      const validationState = lookup === undefined ? store.readFullSlice(id) : emptyAppData();
      validateWrite(validationState, "accounts", stamped, existing, lookup);
      // Record only requested keys whose sanitized, pinned result actually differs from storage.
      commitProductAudit(
        reply,
        {
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId: (merged.accountId as string | undefined) ?? id,
          action: "patch",
          entity: "accounts",
          id,
          changedFields: appliedRequestedFieldNames("accounts", req.body, existing, stamped),
        },
        () => upsertRow(db, "accounts", stamped),
      );
      return reply.code(200).send(redact("accounts", stamped, vis));
    } catch (err) {
      return dependencies.fail(reply, err);
    }
  };

  return { put, patch };
}
