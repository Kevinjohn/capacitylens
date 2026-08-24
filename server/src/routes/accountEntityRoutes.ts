import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Action } from "@capacitylens/shared/domain/access";
import type { CommandIdentity } from "@capacitylens/shared/account/types";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import { SINGLE_COMPANY_CAP_MESSAGE } from "@capacitylens/shared/account/policy";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AuditRecord } from "../audit";
import type { AuthMode } from "../auth";
import { type Db, getRow, upsertRow, insertRow } from "../db";
import type { SanitizeWriteOptions } from "../fieldPolicy";
import type { LocalAccountFlows } from "../accounts/localAccountFlows";
import type { TenantStore } from "../tenantStore";
import { appliedRequestedFieldNames, IMMUTABLE_ACCOUNT_FIELDS, sanitizeWrite, validateWrite } from "../validate";
import { checkEntityWriteBody, prepareScopedWrite, stampServerRevision } from "../writePipeline";

// THE SINGLE HOME FOR `accounts`-ROW WRITE RULES.
//
// `accounts` is the one table in TABLES that is NOT tenant-scoped: it has no `accountId` column, so
// every guard the generic /api/:entity routes derive from `row.accountId` (the isScopedTable
// authorize gate, ownsRow's immutability check, the scoped DELETE's owner assertion) is a no-op for
// it. The generic routes therefore grew ~25 hand-replicated `entity === "accounts"` branches — one
// per verb per rule — and any rule added to one verb but not another silently applied SCOPED-entity
// semantics to an account row. These dedicated STATIC routes own the account rules once each;
// Fastify matches them ahead of the parametric /api/:entity routes, which now refuse `accounts`
// outright. POST /api/batch keeps its own account handling (a client sync diff genuinely carries
// accounts PUT ops — see src/data/syncOps.ts) but shares every predicate exported below, so the two
// paths cannot drift.

/** Auth-on closure of the generic account-create paths. Now that POST /api/orgs exists (P1.8 — the
 * ATOMIC account + built-in Internal client + owner-membership create), the old "onboarding
 * exemption" was an authz bypass: any authenticated user (even one with NO membership anywhere)
 * could mint bare `accounts` rows that NEVER become usable — no membership is ever backfilled (only
 * the Internal client backfills, at restart), so each row is a permanent orphan its own creator
 * cannot read. With auth on, both remaining create vectors (PUT-as-create here, batch PUT-as-create)
 * refuse with this message; /api/orgs covers every legitimate case (first-run bootstrap at zero
 * accounts, an Owner/Admin or bootstrap-token caller under multiAccount). authMode 'off' keeps the
 * open generic create — trusted-local parity: the demo/local/e2e client syncs new companies through
 * the entity routes. */
export const ACCOUNT_CREATE_CLOSED_MESSAGE =
  "Accounts cannot be created through this endpoint when authentication is on. Use POST /api/orgs.";

// SINGLE_COMPANY_CAP_MESSAGE (owner policy — see AppOptions.multiAccount / CLAUDE.md) now lives in
// @capacitylens/shared/account/policy: every route that could add a SECOND `accounts` row — this
// PUT, the batch loop, POST /api/orgs — shares that one shared-package constant so the rule can't
// drift between vectors. Re-exported here so app.ts's existing `from "./routes/accountEntityRoutes"`
// import keeps working unchanged.
export { SINGLE_COMPANY_CAP_MESSAGE };

/** The P1.14 frozen-field refusal, shared by PUT, PATCH and the batch loop (it was three identical
 * string literals, which is exactly how a message drifts between vectors). */
export const ACCOUNT_FROZEN_FIELDS_MESSAGE =
  "Language, week start and time zone are set when the company is created and cannot be changed.";

/** SELECT COUNT(*) FROM accounts — the cap's sole precondition. Same query POST /api/orgs used
 *  before the cap existed; kept as one function so every enforcement point reads the identical
 *  number (never re-derived ad hoc at each call site). */
export function countAccounts(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
}

/**
 * True when creating a NEW `accounts` row right now would violate the single-company cap: the table
 * already holds ≥1 row AND the instance has not opted into `multiAccount`. Callers MUST call this
 * only for the CREATE case (no existing row) — an UPDATE/DELETE of an already-existing account is
 * never capped; enforcement is create-time only, per AppOptions.multiAccount.
 */
export function accountCreateCapped(db: Db, multiAccount: boolean): boolean {
  return !multiAccount && countAccounts(db) > 0;
}

/** Server-owned revision fields are result metadata, not semantic account-command input. */
export function canonicalAccountProductPayload(row: Record<string, unknown>): Record<string, unknown> {
  const canonical = { ...row };
  delete canonical.createdAt;
  delete canonical.updatedAt;
  return canonical;
}

/**
 * True when a sanitised accounts write would CHANGE an already-set frozen field (P1.14) — the
 * violation signal the PUT/PATCH/batch handlers turn into a 409 (per-route) / 400 (batch).
 *
 * Reports a violation ONLY when `existing` has a stored value AND the sanitised incoming value
 * differs. Four deliberate rules:
 *  - Change, not presence: the sync adapter re-sends the WHOLE row on any edit (e.g. a rename),
 *    so an unchanged frozen value MUST pass — only a real change is a violation.
 *  - A missing stored value may be set once, preserving legacy/minimal API-created accounts.
 *  - sanitizeWrite pins an existing value when malformed input is dropped, making it a no-op.
 *  - No existing row → creation, when these values are legitimately SET → never a violation.
 *
 * @param existing the stored row (undefined on a create — always passes)
 * @param incoming the sanitised candidate row, before it is persisted
 */
export function accountFieldsFrozen(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): boolean {
  if (!existing) return false;
  return IMMUTABLE_ACCOUNT_FIELDS.some((field) => existing[field] !== undefined && incoming[field] !== existing[field]);
}

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

/** Both account write paths turn an AccountContractError into the account failure shape and
 *  anything else into the generic redacted failure — one funnel, as the generic routes had. */
function accountRouteFailure(
  reply: FastifyReply,
  error: unknown,
  dependencies: AccountEntityRouteDependencies,
): FastifyReply {
  return error instanceof AccountContractError
    ? dependencies.accountFail(reply, error)
    : dependencies.fail(reply, error);
}

/**
 * The three account-write guards PUT and PATCH both run, byte-identical status codes/bodies, in
 * this fixed order: ownsRow's accountId-immutability 404, the P1.14 frozen-fields 409, then the
 * optimistic-concurrency stale-write 409. Returns true once a response has been sent (the caller
 * must return immediately); false when the write may proceed.
 *
 * PUT interleaves unrelated code (computing `vis`, its trusted-local replay attempt) BETWEEN the
 * frozen guard and the stale guard, so it calls this helper twice — once for `ownsRow`+`frozen`,
 * once afterward for `stale` alone — to keep that interleaving, and therefore behavior, unchanged.
 * PATCH has nothing between the three checks and calls this once with all three.
 *
 * `existing` stays optional (unlike PATCH's already-narrowed row) because PUT also runs the
 * ownsRow/frozen pair on its CREATE path, before any row exists. The stale branch only reaches
 * `existing!` once isStaleWrite's own type guard has confirmed a stored row exists — same
 * non-null assertion the inline PUT check used.
 */
function accountWriteGuards(params: {
  reply: FastifyReply;
  existing: Record<string, unknown> | undefined;
  ownsRow: AccountEntityRouteDependencies["ownsRow"];
  isStaleWrite: AccountEntityRouteDependencies["isStaleWrite"];
  redact: AccountEntityRouteDependencies["redact"];
  checkOwnsRow?: { accountId: unknown };
  checkFrozen?: { candidate: Record<string, unknown> };
  checkStale?: {
    optimisticConcurrency: boolean;
    candidateRow: Record<string, unknown>;
    requirePrecondition?: boolean;
    vis: SanitizeWriteOptions;
  };
}): boolean {
  const { reply, existing, ownsRow, isStaleWrite, redact, checkOwnsRow, checkFrozen, checkStale } = params;
  if (checkOwnsRow && !ownsRow(existing, checkOwnsRow.accountId)) {
    reply.code(404).send({ error: "Not found" });
    return true;
  }
  if (checkFrozen && accountFieldsFrozen(existing, checkFrozen.candidate)) {
    reply.code(409).send({ error: ACCOUNT_FROZEN_FIELDS_MESSAGE });
    return true;
  }
  if (
    checkStale &&
    checkStale.optimisticConcurrency &&
    isStaleWrite(existing, checkStale.candidateRow, checkStale.requirePrecondition)
  ) {
    reply.code(409).send({
      error: "The record was modified more recently on the server.",
      current: redact("accounts", existing!, checkStale.vis),
    });
    return true;
  }
  return false;
}

/**
 * Register the dedicated `accounts` write routes. They are STATIC paths (`/api/accounts…`), which
 * find-my-way matches ahead of the parametric `/api/:entity` routes, so an account row can never
 * reach the generic handlers and pick up scoped-entity semantics.
 */
export function registerAccountEntityRoutes(app: FastifyInstance, dependencies: AccountEntityRouteDependencies): void {
  const {
    db,
    store,
    authMode,
    multiAccount,
    optimisticConcurrency,
    flows,
    authorize,
    command,
    replayCommand,
    fieldVisibility,
    redact,
    commitProductAudit,
    drainProductAudit,
    ownsRow,
    isStaleWrite,
    enqueueAudit,
  } = dependencies;

  // Create a company. CLOSED when auth is on (→ POST /api/orgs, which also mints the Internal
  // client and the owner membership atomically); OPEN in trusted-local OFF mode, still BOUNDED by
  // the single-company cap inside AccountFlows.
  app.post("/api/accounts", async (req, reply) => {
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
  });

  // Idempotent upsert by id — the verb the client sync adapter uses for every create AND update, so
  // a replayed batch (after a partial failure) is safe. The body's id must match the URL id.
  app.put("/api/accounts/:id", async (req, reply) => {
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
        accountId: (body.accountId as string | undefined) ?? id,
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
  });

  // True partial patch: merge the body over the stored row, then sanitize + validate the MERGED
  // entity before writing. (A blind column-wise update would null every field the body omits.)
  // 404 when the row doesn't exist — a PATCH is therefore always an UPDATE, never a create.
  app.patch("/api/accounts/:id", (req, reply) => {
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
  });

  // Hard-delete a company. This is a TENANT ERASURE, not a bare row delete: dropping an `accounts`
  // row CASCADES (FK ON DELETE CASCADE) and wipes ALL the account's scoped data, so AccountFlows
  // coordinates the product cascade, administration sweep and orphaned local-identity erasure in one
  // transaction.
  app.delete("/api/accounts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { accountId } = req.query as { accountId?: string };
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
        accountId: accountId ?? id,
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
  });
}
