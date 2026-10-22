import type { EffectiveRoleResult } from "./appAuthorization";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccountAdminPort } from "@capacitylens/shared/account/ports";
import type { Role } from "@capacitylens/shared/account/types";
import type { AccountMode } from "../auth";
import type { Db } from "../db";
import { listAccountSummaries, readState } from "../db";
import type { MasqueradeRegistry } from "../MasqueradeRegistry";
import type { AccountStore } from "../accountStore";
import { buildReadSliceVisibility, resolveVisibilityForRole } from "../fieldPolicy";
import { ALL_FIELDS_VISIBLE } from "./routeShared";
import type { AuthorizeRoute } from "./routeShared";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";
import { REPLY_ERRORS } from "./replyErrors";

/** Dependencies for account and state read projections. */
export interface StateReadRouteDependencies {
  db: Db;
  store: AccountStore;
  authMode: AccountMode;
  accountAdminPort: Pick<AccountAdminPort, "listWorkspacesForPrincipal">;
  masquerades: MasqueradeRegistry;
  authorize: AuthorizeRoute;
  resolveEffectiveRole: (req: FastifyRequest, accountId: string) => EffectiveRoleResult;
}

function requireAccountActor(req: FastifyRequest): NonNullable<FastifyRequest["accountActor"]> {
  if (!req.accountActor) throw new Error("Expected account actor context on an authenticated state route.");
  return req.accountActor;
}

async function listAccounts(
  req: FastifyRequest,
  reply: FastifyReply,
  dependencies: StateReadRouteDependencies,
): Promise<FastifyReply> {
  const { db, authMode, accountAdminPort, masquerades, resolveEffectiveRole } = dependencies;
  if (authMode === "off") {
    // Off mode has no membership gate; return every company with owner as its trusted-local capability sentinel.
    const accounts = listAccountSummaries(db);
    return reply
      .code(200)
      .send(accounts.map((account) => ({ id: account.id, name: account.name, role: "owner" as const })));
  }
  const memberships = await accountAdminPort.listWorkspacesForPrincipal({
    principalId: requireAccountActor(req).principalId,
  });
  // Revalidate the projected account even when the caller's membership was removed and the
  // account therefore no longer appears in `memberships`. The triggering request must end with
  // MASQUERADE_ENDED, never silently return another-account data under a stale client phase.
  const activeRecord = req.session ? masquerades.peek(req.session.id) : null;
  let projectedRole: Role | null = null;
  if (activeRecord) {
    const activeResolution = resolveEffectiveRole(req, activeRecord.accountId);
    if (activeResolution.kind === "ended") {
      return reply.code(403).send({ error: REPLY_ERRORS.masqueradeEnded, code: MASQUERADE_ERROR_CODES.ended });
    }
    projectedRole = activeResolution.role;
  }
  return reply.code(200).send(
    memberships.map((membership) => ({
      id: membership.workspaceId,
      name: membership.workspaceName,
      role: membership.workspaceId === activeRecord?.accountId ? (projectedRole ?? membership.role) : membership.role,
    })),
  );
}

// Repeated query keys arrive as arrays, so the declared type admits them and the handler checks.
interface StateReadRoute {
  Querystring: { accountId?: string | string[]; includeInactive?: string | string[] };
}

function readStateRoute(
  req: FastifyRequest<StateReadRoute>,
  reply: FastifyReply,
  dependencies: StateReadRouteDependencies,
): FastifyReply | undefined {
  const { db, store, authMode, authorize } = dependencies;
  const { accountId, includeInactive } = req.query;
  if (accountId !== undefined) {
    if (typeof accountId !== "string" || accountId.length === 0) {
      return reply.code(400).send({ error: REPLY_ERRORS.accountIdNonEmpty });
    }
    const authorization = authorize({ req, reply, accountId, action: "read" });
    if (authorization.kind === "denied") return;
    const visibility = authMode === "off" ? ALL_FIELDS_VISIBLE : resolveVisibilityForRole(authorization.role);
    if (includeInactive !== undefined && includeInactive !== "1") {
      return reply.code(400).send({ error: REPLY_ERRORS.includeInactiveInvalid });
    }
    const wantsInactive = includeInactive === "1";
    if (wantsInactive && authorize({ req, reply, accountId, action: "purge" }).kind === "denied") return;
    return reply.code(200).send(
      store.readSlice(accountId, {
        ...buildReadSliceVisibility(visibility),
        includeInactive: wantsInactive,
      }),
    );
  }
  if (authMode !== "off") return reply.code(400).send({ error: REPLY_ERRORS.accountIdRequired });
  return reply.code(200).send(readState(db));
}

/** Registers the account and whole-state read routes. */
export function registerStateRoutes(app: FastifyInstance, dependencies: StateReadRouteDependencies): void {
  // The login → account list drives the AccountPicker. Off mode is trusted-local:
  // Every account is accessible, so return all summaries with no membership gate, branch on
  // authMode === 'off' before touching membership (the off guarantee). Auth-on returns only the
  // caller's memberships through AccountAdminPort. Returns AccountSummary[] = [{ id, name, role }].
  app.get("/api/accounts", (req, reply) => listAccounts(req, reply, dependencies));

  // Whole-state read backs the client's PersistenceAdapter.loadAll(). Only writes are entity-level;
  // reads stay whole-tree so hydration is one round-trip.
  //
  // With `?accountId=`, return that account's scoped slice through AccountStore. Off mode is
  // trusted-local; auth-on requires read authorization and cannot cross tenant boundaries.
  app.get<StateReadRoute>("/api/state", (req, reply) => {
    // Authorize tenant reads before loading data and derive confidentiality from the shared field-policy catalogue.
    // Inactive rows require purge authority; all projections still redact fields the actor cannot see.
    // Whole-database reads remain trusted-local only and never include authentication or control tables.
    return readStateRoute(req, reply, dependencies);
  });
}
