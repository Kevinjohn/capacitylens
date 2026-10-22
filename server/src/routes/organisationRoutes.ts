import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { CommandIdentity } from "@capacitylens/shared/account/types";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { isMatchingSecretToken } from "../auth";
import type { Auth, AccountMode } from "../auth";
import type { Db } from "../db";
import { insertRow } from "../db";
import type { LocalAccountFlows } from "../accounts/createLocalAccountFlows";
import { listAcceptedFieldNames, sanitizeWrite, assertValidWrite } from "../validate";
import { enqueueAudit } from "../auditOutbox";
import { buildCanonicalAccountProductPayload } from "./accountEntityRoutes";
import { isRecord } from "@capacitylens/shared/lib/isRecord";
import { REPLY_ERRORS } from "./replyErrors";

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

function requireAccountActor(req: FastifyRequest): NonNullable<FastifyRequest["accountActor"]> {
  if (!req.accountActor) throw new Error("Expected account actor context on an authenticated state route.");
  return req.accountActor;
}

/** Dependencies for atomic organization provisioning. */
export interface OrganisationRouteDependencies {
  db: Db;
  authMode: AccountMode;
  auth: Auth | null;
  multiAccount: boolean;
  bootstrapToken?: string;
  accountFlows: Pick<LocalAccountFlows, "provisionWorkspace">;
  accountCommand: (req: FastifyRequest) => CommandIdentity;
  accountFail: (reply: FastifyReply, error: unknown) => FastifyReply;
  sendFail: (reply: FastifyReply, error: unknown) => FastifyReply;
  drainProductAudit: (reply: FastifyReply) => boolean;
}

function requireUserId(req: FastifyRequest): string {
  if (!req.user) throw new Error("Expected user context on an authenticated organization route.");
  return req.user.id;
}

interface OrganisationProvisionInput {
  req: FastifyRequest;
  reply: FastifyReply;
  dependencies: OrganisationRouteDependencies;
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
  dependencies: OrganisationRouteDependencies,
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

/** Registers atomic organization provisioning. */
export function registerOrganisationRoutes(app: FastifyInstance, dependencies: OrganisationRouteDependencies): void {
  app.post("/api/orgs", (req, reply) => createOrganisation(req, reply, dependencies));
}
