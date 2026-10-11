import type { EffectiveRoleResult } from "./appAuthorization";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccountAdminPort } from "@capacitylens/shared/account/ports";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { CommandIdentity, Role } from "@capacitylens/shared/account/types";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { isMatchingSecretToken } from "../auth";
import type { Auth, AccountMode } from "../auth";
import type { Db } from "../db";
import { insertRow, listAccountSummaries, readState } from "../db";
import type { LocalAccountFlows } from "../accounts/createLocalAccountFlows";
import type { MasqueradeRegistry } from "../MasqueradeRegistry";
import type { AccountStore } from "../accountStore";
import { listAcceptedFieldNames, sanitizeWrite, assertValidWrite } from "../validate";
import { buildReadSliceVisibility, resolveVisibilityForRole } from "../fieldPolicy";
import { enqueueAudit } from "../auditOutbox";
import { buildCanonicalAccountProductPayload } from "./accountEntityRoutes";
import { ALL_FIELDS_VISIBLE } from "./routeShared";
import type { AuthorizeRoute } from "./routeShared";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";
import { isRecord } from "@capacitylens/shared/lib/isRecord";
import { REPLY_ERRORS } from "./replyErrors";

type StateAccountAdministration = AccountAdminPort & {
  roleForPrincipalInWorkspace(principalId: string, workspaceId: string): Role | null;
};

// Derive omitted workspace IDs from the command so an identical retry addresses the same durable outcome.
function buildWorkspaceId(commandId: string): string {
  return `w_${createHash("sha256")
    .update("capacitylens-workspace-command\0")
    .update(commandId)
    .digest("base64url")
    .slice(0, 21)}`;
}

function resolveWorkspaceId(body: unknown, commandId: string): string {
  if (isRecord(body) && typeof body.id === "string" && body.id.trim() !== "") return body.id;
  return buildWorkspaceId(commandId);
}

/** Dependencies shared by the state read and organization routes. */
export interface StateRouteDependencies {
  section: "read" | "org";
  db: Db;
  store: AccountStore;
  authMode: AccountMode;
  auth: Auth | null;
  multiAccount: boolean;
  bootstrapToken?: string;
  accountAdminPort: StateAccountAdministration;
  accountFlows: LocalAccountFlows;
  masquerades: MasqueradeRegistry;
  authorize: AuthorizeRoute;
  resolveEffectiveRole: (req: FastifyRequest, accountId: string) => EffectiveRoleResult;
  accountCommand: (req: FastifyRequest) => CommandIdentity;
  accountFail: (reply: FastifyReply, error: unknown) => FastifyReply;
  sendFail: (reply: FastifyReply, error: unknown) => FastifyReply;
  drainProductAudit: (reply: FastifyReply) => boolean;
}

function requireAccountActor(req: FastifyRequest): NonNullable<FastifyRequest["accountActor"]> {
  if (!req.accountActor) throw new Error("Expected account actor context on an authenticated state route.");
  return req.accountActor;
}

function requireUserId(req: FastifyRequest): string {
  if (!req.user) throw new Error("Expected user context on an authenticated state route.");
  return req.user.id;
}

async function listAccounts(
  req: FastifyRequest,
  reply: FastifyReply,
  dependencies: StateRouteDependencies,
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
  let projectedRole: ReturnType<typeof accountAdminPort.roleForPrincipalInWorkspace> = null;
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
  dependencies: StateRouteDependencies,
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

function registerReadRoutes(app: FastifyInstance, dependencies: StateRouteDependencies): void {
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

interface OrganisationProvisionInput {
  req: FastifyRequest;
  reply: FastifyReply;
  dependencies: StateRouteDependencies;
  command: CommandIdentity;
  bootstrapAuthorized: boolean;
  now: string;
  id: string;
  accountRow: Record<string, unknown>;
}

async function provisionOrganisation(input: OrganisationProvisionInput): Promise<FastifyReply> {
  const { req, reply, dependencies, command, bootstrapAuthorized, now, id, accountRow } = input;
  const { db, multiAccount, accountFlows, drainProductAudit } = dependencies;
  // Server timestamps are result data, not caller intent. Excluding them from the command
  // digest lets an identical retry replay the first committed row after wall time advances.
  const canonicalAccountRow = buildCanonicalAccountProductPayload(accountRow);
  const provisioned = await accountFlows.provisionWorkspace({
    actor: requireAccountActor(req),
    workspaceId: id,
    joinedAt: now,
    command,
    multiWorkspace: multiAccount,
    bootstrapAuthorized,
    canonicalProductPayload: canonicalAccountRow,
    provisionProductData: () => {
      // Account validation has no referential dependencies, so an empty projection is sufficient.
      assertValidWrite({ state: emptyAppData(), table: "accounts", row: accountRow });
      insertRow(db, "accounts", accountRow);
      insertRow(db, "clients", buildInternalClient(id, now) as unknown as Record<string, unknown>);
      enqueueAudit(db, {
        ts: String(accountRow.createdAt),
        userId: requireUserId(req),
        accountId: id,
        action: "create",
        entity: "accounts",
        id,
        changedFields: listAcceptedFieldNames("accounts", accountRow),
      });
      return accountRow;
    },
  });
  if (!provisioned.replayed) drainProductAudit(reply);
  return reply.code(201).send(provisioned.product);
}

function isPermittedCompanyProvider(auth: Auth | null, providerId: string | null): boolean {
  if (providerId === null) return false;
  return auth?.permittedCompanyProviderIds?.has(providerId) ?? providerId === auth?.defaultCompanyProvider?.id;
}

async function createOrganisation(
  req: FastifyRequest,
  reply: FastifyReply,
  dependencies: StateRouteDependencies,
): Promise<FastifyReply> {
  const { authMode, auth, bootstrapToken, accountCommand, accountFail, sendFail } = dependencies;

  // Provision company data, its Internal client and owner membership atomically under the provisioning lock.
  // The company-count cap applies before caller authorization and cannot be bypassed by off mode or a bootstrap token.
  try {
    if (!isRecord(req.body)) return reply.code(400).send({ error: REPLY_ERRORS.companyDetailsNotObject });

    // Ordinary company writes reject malformed supplied fields before canonicalization.
    // Omitted IDs derive from the command for replay; explicit IDs must pass ordinary validation.
    if (authMode === "sso-only" && !isPermittedCompanyProvider(auth, req.authenticationProviderId)) {
      return accountFail(
        reply,
        new AccountContractError({
          code: "FORBIDDEN",
          message: REPLY_ERRORS.ssoRequiredBeforeCompanyCreate,
          retryable: false,
        }),
      );
    }
    const command = accountCommand(req);
    const bootstrapAuthorized = isMatchingSecretToken(bootstrapToken, req.headers["x-capacitylens-bootstrap-token"]);
    const now = new Date().toISOString();
    const id = resolveWorkspaceId(req.body, command.commandId);
    const accountRow = sanitizeWrite({
      table: "accounts",
      requested: req.body,
      row: {
        ...req.body,
        schedulingMode: req.body.schedulingMode ?? "days",
        inlineActivityCreateEnabled: req.body.inlineActivityCreateEnabled ?? false,
        id,
        createdAt: now,
        updatedAt: now,
      },
    });
    const response = await provisionOrganisation({
      req,
      reply,
      dependencies,
      command,
      bootstrapAuthorized,
      now,
      id,
      accountRow,
    });
    return response;
  } catch (error) {
    // Preserve typed provisioning refusals and redact unexpected setup faults rather than returning a usable-company receipt.
    return error instanceof AccountContractError ? accountFail(reply, error) : sendFail(reply, error);
  }
}

/** Registers state and organization routes for the configured section. */
export function registerStateRoutes(app: FastifyInstance, dependencies: StateRouteDependencies): void {
  if (dependencies.section === "read") {
    registerReadRoutes(app, dependencies);
    return;
  }
  app.post("/api/orgs", (req, reply) => createOrganisation(req, reply, dependencies));
}
