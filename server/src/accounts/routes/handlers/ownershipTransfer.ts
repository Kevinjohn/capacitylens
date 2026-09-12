import { AccountContractError } from "@capacitylens/shared/account/errors";
import type {
  OwnershipTransferOutcome,
  OwnershipTransferRequest,
} from "@capacitylens/shared/account/ownershipTransfer";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AccountRouteContext } from "../createReplyHelpers";

/**
 * The HTTP adapter for the three-step ownership transfer ceremony.
 *
 * Seven explicit routes rather than one `PATCH {state}`: each step has a different authorised
 * caller, and a generic patch would invite invalid caller/state combinations and spread policy into
 * request parsing. Transport validation and response shape live here; every authorisation question
 * is answered by the port inside its transaction, where the membership facts are still true.
 */

/** The wire projection of one request. Ids and instants only — display identity is resolved from
 *  the member directory, so the ceremony never becomes a second store of personal data. */
function toWire(request: OwnershipTransferRequest) {
  return {
    id: request.id,
    fromUserId: request.initiatorUserId,
    toUserId: request.targetUserId,
    state: request.state,
    revision: request.revision,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    targetAcceptedAt: request.targetAcceptedAt,
    terminalAt: request.terminalAt,
    terminalReason: request.terminalReason,
  };
}

function createAuthenticationRequiredError() {
  return new AccountContractError({
    code: "AUTHENTICATION_REQUIRED",
    message: "Sign in to continue.",
    retryable: false,
  });
}

function requireAuthenticatedPrincipal(req: FastifyRequest) {
  if (!req.accountActor || !req.user) throw createAuthenticationRequiredError();
  return { actor: req.accountActor, user: req.user };
}

/**
 * A committed business-terminal outcome answered as a conflict.
 *
 * It is NOT an error: the expiry it reports was written and committed. The caller's command did not
 * apply, so 409 is the honest status — but the body names the terminal state and reason so an
 * interface can explain what happened rather than merely refusing.
 */
function sendTerminal(reply: FastifyReply, outcome: Extract<OwnershipTransferOutcome, { kind: "terminal" }>) {
  return reply.code(409).send({
    error: "This ownership transfer is no longer open.",
    code: "OWNERSHIP_TRANSFER_TERMINAL",
    state: outcome.state,
    reason: outcome.reason,
  });
}

/**
 * Refuse the ceremony read while masquerading.
 *
 * The global masquerade policy already refuses every unsafe method, which covers the six commands.
 * It deliberately does not cover GET — so this read, which names who is being handed the company,
 * refuses here. Concealment, not redaction: a masquerading session is not the participant whose
 * ceremony this is.
 */
function refuseUnderMasquerade(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext): boolean {
  if (!context.isMasquerading(req)) return false;
  void reply.code(403).send({ error: "Masquerade is read-only.", code: MASQUERADE_ERROR_CODES.readOnly });
  return true;
}

export async function readOwnershipTransfer(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const { administration, authMode, authorize, fail: accountFail } = context;
  const { accountId } = req.params as { accountId: string };
  if (!authorize({ req, reply, accountId, action: "actOnOwnershipTransfer", options: { requireFreshSession: false } }))
    return;
  // OFF mode has no owner model at all, so an honest empty projection beats a crash or a claim.
  if (authMode === "off") return { live: null, latestOutcome: null };
  if (refuseUnderMasquerade(req, reply, context)) return;
  try {
    const { actor } = requireAuthenticatedPrincipal(req);
    const projection = await administration.readOwnershipTransfer({ actor, workspaceId: accountId });
    return {
      live: projection.live ? toWire(projection.live) : null,
      latestOutcome: projection.latestOutcome ? toWire(projection.latestOutcome) : null,
    };
  } catch (error) {
    return accountFail(reply, error);
  }
}

interface ReplacementPredicate {
  expectedRequestId: string | null;
  expectedRevision: string | null;
}

/**
 * Read the replacement predicate from an initiation body.
 *
 * Both absent means "there must be no live request"; both present means "replace exactly this one,
 * at exactly this revision". One without the other is a malformed intent, not a lenient default:
 * accepting it would let a client replace whatever happened to be live.
 */
function readReplacementPredicate(body: Record<string, unknown>): ReplacementPredicate | null {
  const id = body.expectedRequestId;
  const revision = body.expectedRevision;
  if (id === undefined && revision === undefined) return { expectedRequestId: null, expectedRevision: null };
  if (typeof id !== "string" || id.length === 0 || typeof revision !== "string" || revision.length === 0) return null;
  return { expectedRequestId: id, expectedRevision: revision };
}

export async function initiateOwnershipTransfer(
  req: FastifyRequest,
  reply: FastifyReply,
  context: AccountRouteContext,
) {
  const { administration, command: accountCommand, fail: accountFail, auditUnlessReplayed } = context;
  const { accountId } = req.params as { accountId: string };
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.toUserId !== "string" || body.toUserId.length === 0) {
    return reply.code(400).send({ error: "toUserId must be a non-empty string." });
  }
  const predicate = readReplacementPredicate(body);
  if (!predicate) {
    return reply
      .code(400)
      .send({ error: "expectedRequestId and expectedRevision must be supplied together as non-empty strings." });
  }
  const toUserId = body.toUserId;
  if (!context.authorizeMemberMutation({ req, reply, accountId, action: "actOnOwnershipTransfer" })) return;
  try {
    const { actor, user } = requireAuthenticatedPrincipal(req);
    const outcome = await administration.initiateOwnershipTransfer({
      actor,
      workspaceId: accountId,
      targetPrincipalId: toUserId,
      ...predicate,
      command: accountCommand(req),
    });
    if (outcome.kind === "terminal") return sendTerminal(reply, outcome);
    auditUnlessReplayed({
      reply,
      result: outcome,
      record: {
        ts: new Date().toISOString(),
        userId: user.id,
        accountId,
        action: "ownershipTransferRequest",
        entity: "membership",
        id: outcome.request.id,
        changedFields: ["state"],
      },
    });
    return reply.code(201).send({ request: toWire(outcome.request) });
  } catch (error) {
    return accountFail(reply, error);
  }
}

type RowCommand = "accept" | "withdraw" | "decline" | "cancel" | "complete";

interface RowCommandInput {
  req: FastifyRequest;
  reply: FastifyReply;
  context: AccountRouteContext;
  action: RowCommand;
}

/** Completion is the moment ownership actually moves, so it keeps the standing `ownershipTransfer`
 *  audit action; every other step records the ceremony action instead. */
function auditActionFor(action: RowCommand): "ownershipTransfer" | "ownershipTransferRequest" {
  return action === "complete" ? "ownershipTransfer" : "ownershipTransferRequest";
}

function commandFor(context: AccountRouteContext, action: RowCommand) {
  const { administration } = context;
  return {
    accept: administration.acceptOwnershipTransfer,
    withdraw: administration.withdrawOwnershipTransfer,
    decline: administration.declineOwnershipTransfer,
    cancel: administration.cancelOwnershipTransfer,
    complete: administration.completeOwnershipTransfer,
  }[action].bind(administration);
}

/**
 * The shared body of the five row commands.
 *
 * They differ only in which port method they call and which audit action they record: the
 * transport shape, the validation, the gate and the conflict mapping are identical, and keeping one
 * copy is what stops the five drifting apart.
 */
async function runRowCommand({ req, reply, context, action }: RowCommandInput) {
  const { command: accountCommand, fail: accountFail, auditUnlessReplayed } = context;
  const { accountId, requestId } = req.params as { accountId: string; requestId: string };
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.expectedRevision !== "string" || body.expectedRevision.length === 0) {
    return reply.code(400).send({ error: "expectedRevision must be a non-empty string." });
  }
  const expectedRevision = body.expectedRevision;
  if (!context.authorizeMemberMutation({ req, reply, accountId, action: "actOnOwnershipTransfer" })) return;
  try {
    const { actor, user } = requireAuthenticatedPrincipal(req);
    const outcome = await commandFor(
      context,
      action,
    )({
      actor,
      workspaceId: accountId,
      requestId,
      expectedRevision,
      command: accountCommand(req),
    });
    if (outcome.kind === "terminal") return sendTerminal(reply, outcome);
    auditUnlessReplayed({
      reply,
      result: outcome,
      record: {
        ts: new Date().toISOString(),
        userId: user.id,
        accountId,
        action: auditActionFor(action),
        entity: "membership",
        id: outcome.request.id,
        changedFields: action === "complete" ? ["state", "role"] : ["state"],
      },
    });
    return reply.code(200).send({ request: toWire(outcome.request) });
  } catch (error) {
    return accountFail(reply, error);
  }
}

export const acceptOwnershipTransfer = (req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) =>
  runRowCommand({ req, reply, context, action: "accept" });

export const withdrawOwnershipTransfer = (req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) =>
  runRowCommand({ req, reply, context, action: "withdraw" });

export const declineOwnershipTransfer = (req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) =>
  runRowCommand({ req, reply, context, action: "decline" });

export const cancelOwnershipTransfer = (req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) =>
  runRowCommand({ req, reply, context, action: "cancel" });

export const completeOwnershipTransfer = (req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) =>
  runRowCommand({ req, reply, context, action: "complete" });
