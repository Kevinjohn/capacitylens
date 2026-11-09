import type { HttpContext } from '@adonisjs/core/http';
import { parseBetaExport } from '@capacitylens/shared/data/betaTransfer';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import {
  ACTION_PROOF_KINDS,
  actionProofActor,
  type ActionProofKind,
} from '#services/auth/action_proof';
import { accountInput, withActor } from '#services/auth/current_actor';
import { classifyLogError, reportPrivateFailure } from '#services/logging_safety';

type ProofRequest = {
  action: ActionProofKind;
  accountId: string;
  intent: unknown;
  password: string;
};

function requestBody(value: unknown): ProofRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const fields = ['action', 'accountId', 'intent', 'password'];
  if (Object.keys(body).some((key) => !fields.includes(key))) return null;
  if (!ACTION_PROOF_KINDS.includes(body.action as ActionProofKind)) return null;
  if (typeof body.accountId !== 'string' || !body.accountId) return null;
  if (typeof body.password !== 'string') return null;
  if (!body.intent || typeof body.intent !== 'object' || Array.isArray(body.intent)) return null;
  const intent = body.intent as Record<string, unknown>;
  if (body.action === 'transfer-ownership') {
    if (
      Object.keys(intent).length !== 1 ||
      typeof intent.toUserId !== 'string' ||
      !intent.toUserId
    ) {
      return null;
    }
  } else if (body.action === 'import') {
    if (
      Object.keys(intent).length !== 2 ||
      !Number.isSafeInteger(intent.baseRevision) ||
      (intent.baseRevision as number) < 0
    ) {
      return null;
    }
    try {
      return {
        ...body,
        intent: {
          baseRevision: intent.baseRevision,
          document: parseBetaExport(JSON.stringify(intent.document)),
        },
      } as ProofRequest;
    } catch {
      return null;
    }
  } else if (Object.keys(intent).length !== 0) return null;
  return body as ProofRequest;
}

export default class ActionProofsController {
  async password(ctx: HttpContext) {
    const body = requestBody(ctx.request.body());
    if (!body) return ctx.response.badRequest({ error: 'Invalid action confirmation.' });
    await withActor(ctx, async (_actor, trx) => actionProofActor(body.accountId, trx));
    const { confirmationId } = await passwordConfirmations.confirmPassword(
      await accountInput(ctx),
      {
        action: body.action,
        scope: body.accountId,
        intent: body.intent,
        password: body.password,
      }
    );
    try {
      await passwordConfirmations.prune();
    } catch (error) {
      reportPrivateFailure(
        ctx,
        { event: 'action_proof.prune', errorType: classifyLogError(error) },
        'Action proof pruning failed'
      );
    }
    return ctx.response.ok({ proofId: confirmationId });
  }
}
