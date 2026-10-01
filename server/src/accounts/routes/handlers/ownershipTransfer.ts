import type {
  OwnershipTransferOutcome,
  OwnershipTransferRequest,
} from "@capacitylens/shared/account/ownershipTransfer";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";
import type { FastifyReply, FastifyRequest } from "fastify";
import { REPLY_ERRORS } from "../../../routes/replyErrors";
import type { ParseResult } from "../../../routes/routeShared";
import type { AccountRoute, OwnershipTransferRequestRoute } from "../accountRouteDependencies";
import type { AccountRouteContext } from "../createReplyHelpers";
import { requireAuthenticatedPrincipal } from "./authenticatedPrincipal";

/**
 * The HTTP adapter for the three-step ownership transfer ceremony.
 *
 * Seven explicit routes rather than one `PATCH {state}`: each step has a different authorised
 * caller, and a generic patch would invite invalid caller/state combinations and spread policy into
 * request parsing. Transport validation and response shape live here; every authorisation question
 * is answered by the port inside its transaction, where the membership facts are still true.
 */

/** The wire projection of one request. Ids and instants only — display identity is resolved from
 * the member directory, so the ceremony never becomes a second store of personal data. */
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

/**
 * A committed business-terminal outcome answered as a conflict.
 *
 * It is NOT an error: the expiry it reports was written and committed. The caller's command did not
 * apply, so 409 is the honest status — but the body names the terminal state and reason so an
 * interface can explain what happened rather than merely refusing.
 */
function sendTerminal(reply: FastifyReply, outcome: Extract<OwnershipTransferOutcome, { kind: "terminal" }>) {
  return reply.code(409).send({
    error: REPLY_ERRORS.ownershipTransferClosed,
    code: "OWNERSHIP_TRANSFER_TERMINAL",
    state: outcome.state,
    reason: outcome.reason,
  });
}

/**
 * Send the refusal for a ceremony read while masquerading; null when the read may proceed.
 *
 * The global masquerade policy already refuses every unsafe method, which covers the six commands.
 * It deliberately does not cover GET — so this read, which names who is being handed the company,
 * refuses here. Concealment, not redaction: a masquerading session is not the participant whose
 * ceremony this is.
 */
function sendMasqueradeRefusal(
  req: FastifyRequest,
  reply: FastifyReply,
  context: Pick<AccountRouteContext, "isMasquerading">,
): FastifyReply | null {
  if (!context.isMasquerading(req)) return null;
  return reply.code(403).send({ error: REPLY_ERRORS.masqueradeReadOnly, code: MASQUERADE_ERROR_CODES.readOnly });
}

export async function readOwnershipTransfer(
  req: FastifyRequest<AccountRoute>,
  reply: FastifyReply,
  context: Pick<AccountRouteContext, "administration" | "authMode" | "authorize" | "fail" | "isMasquerading">,
) {
  const { administration, authMode, authorize, fail: accountFail } = context;
  const { accountId } = req.params;
  if (!authorize({ req, reply, accountId, action: "actOnOwnershipTransfer", options: { requireFreshSession: false } }))
    return;
  // OFF mode has no owner model at all, so an honest empty projection beats a crash or a claim.
  if (authMode === "off") return reply.code(200).send({ live: null, latestOutcome: null });
  const masqueradeRefusal = sendMasqueradeRefusal(req, reply, context);
  if (masqueradeRefusal) return masqueradeRefusal;
  try {
    const { actor } = requireAuthenticatedPrincipal(req);
    const projection = await administration.readOwnershipTransfer({ actor, workspaceId: accountId });
    return reply.code(200).send({
      live: projection.live ? toWire(projection.live) : null,
      latestOutcome: projection.latestOutcome ? toWire(projection.latestOutcome) : null,
    });
  } catch (error) {
    return accountFail(reply, error);
  }
}

interface ReplacementPredicate {
  expectedRequestId: string | null;
  expectedRevision: string | null;
}

/**
 * Parse an initiation body: the nominee, then the replacement predicate.
 *
 * Both predicate fields absent means "there must be no live request"; both present means "replace
 * exactly this one, at exactly this revision". One without the other is a malformed intent, not a
 * lenient default: accepting it would let a client replace whatever happened to be live.
 */
function parseInitiation(value: unknown): ParseResult<{ toUserId: string; predicate: ReplacementPredicate }, string> {
  const body = (value ?? {}) as Record<string, unknown>;
  if (typeof body.toUserId !== "string" || body.toUserId.length === 0) {
    return { kind: "invalid", failure: REPLY_ERRORS.ownershipTransferTargetRequired };
  }
  const id = body.expectedRequestId;
  const revision = body.expectedRevision;
  if (id === undefined && revision === undefined) {
    return {
      kind: "parsed",
      value: { toUserId: body.toUserId, predicate: { expectedRequestId: null, expectedRevision: null } },
    };
  }
  if (typeof id !== "string" || id.length === 0 || typeof revision !== "string" || revision.length === 0) {
    return { kind: "invalid", failure: REPLY_ERRORS.ownershipTransferReplacementInvalid };
  }
  return {
    kind: "parsed",
    value: { toUserId: body.toUserId, predicate: { expectedRequestId: id, expectedRevision: revision } },
  };
}

function parseExpectedRevision(value: unknown): ParseResult<string, string> {
  const body = (value ?? {}) as Record<string, unknown>;
  if (typeof body.expectedRevision !== "string" || body.expectedRevision.length === 0) {
    return { kind: "invalid", failure: REPLY_ERRORS.ownershipTransferRevisionRequired };
  }
  return { kind: "parsed", value: body.expectedRevision };
}

type InitiateOwnershipTransferContext = Pick<
  AccountRouteContext,
  "administration" | "auditUnlessReplayed" | "authorizeMemberMutation" | "command" | "fail"
>;

export async function initiateOwnershipTransfer(
  req: FastifyRequest<AccountRoute>,
  reply: FastifyReply,
  context: InitiateOwnershipTransferContext,
) {
  const { administration, command: accountCommand, fail: accountFail, auditUnlessReplayed } = context;
  const { accountId } = req.params;
  const parsed = parseInitiation(req.body);
  if (parsed.kind === "invalid") return reply.code(400).send({ error: parsed.failure });
  const { toUserId, predicate } = parsed.value;
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
  req: FastifyRequest<OwnershipTransferRequestRoute>;
  reply: FastifyReply;
  context: Pick<
    AccountRouteContext,
    "administration" | "auditUnlessReplayed" | "authorizeMemberMutation" | "command" | "fail"
  >;
  action: RowCommand;
}

/** Completion is the moment ownership actually moves, so it keeps the standing `ownershipTransfer`
 * audit action; every other step records the ceremony action instead. */
function auditActionFor(action: RowCommand): "ownershipTransfer" | "ownershipTransferRequest" {
  return action === "complete" ? "ownershipTransfer" : "ownershipTransferRequest";
}

function commandFor(context: Pick<AccountRouteContext, "administration">, action: RowCommand) {
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
  const { accountId, requestId } = req.params;
  const parsed = parseExpectedRevision(req.body);
  if (parsed.kind === "invalid") return reply.code(400).send({ error: parsed.failure });
  const expectedRevision = parsed.value;
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

export const acceptOwnershipTransfer = (
  req: FastifyRequest<OwnershipTransferRequestRoute>,
  reply: FastifyReply,
  context: Pick<
    AccountRouteContext,
    "administration" | "auditUnlessReplayed" | "authorizeMemberMutation" | "command" | "fail"
  >,
) => runRowCommand({ req, reply, context, action: "accept" });

export const withdrawOwnershipTransfer = (
  req: FastifyRequest<OwnershipTransferRequestRoute>,
  reply: FastifyReply,
  context: Pick<
    AccountRouteContext,
    "administration" | "auditUnlessReplayed" | "authorizeMemberMutation" | "command" | "fail"
  >,
) => runRowCommand({ req, reply, context, action: "withdraw" });

export const declineOwnershipTransfer = (
  req: FastifyRequest<OwnershipTransferRequestRoute>,
  reply: FastifyReply,
  context: Pick<
    AccountRouteContext,
    "administration" | "auditUnlessReplayed" | "authorizeMemberMutation" | "command" | "fail"
  >,
) => runRowCommand({ req, reply, context, action: "decline" });

export const cancelOwnershipTransfer = (
  req: FastifyRequest<OwnershipTransferRequestRoute>,
  reply: FastifyReply,
  context: Pick<
    AccountRouteContext,
    "administration" | "auditUnlessReplayed" | "authorizeMemberMutation" | "command" | "fail"
  >,
) => runRowCommand({ req, reply, context, action: "cancel" });

export const completeOwnershipTransfer = (
  req: FastifyRequest<OwnershipTransferRequestRoute>,
  reply: FastifyReply,
  context: Pick<
    AccountRouteContext,
    "administration" | "auditUnlessReplayed" | "authorizeMemberMutation" | "command" | "fail"
  >,
) => runRowCommand({ req, reply, context, action: "complete" });
