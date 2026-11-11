import type { HttpContext } from '@adonisjs/core/http';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import {
  PASSWORD_CONFIRMATION_KINDS,
  passwordConfirmationActor,
  type PasswordConfirmationKind,
} from '#services/auth/password_confirmation';
import { accountInput, withActor } from '#services/auth/current_actor';
import { classifyLogError, reportPrivateFailure } from '#services/logging_safety';
import { parseRequestDocument } from '#services/beta_account_transfer';

type ConfirmationRequest = {
  action: PasswordConfirmationKind;
  /** The company the action applies to; absent for `delete-account`, which is scoped to the caller. */
  accountId?: string;
  intent: unknown;
  password: string;
};

function requestBody(value: unknown): ConfirmationRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!PASSWORD_CONFIRMATION_KINDS.includes(body.action as PasswordConfirmationKind)) return null;
  const ownAccount = body.action === 'delete-account';
  const fields = ownAccount
    ? ['action', 'intent', 'password']
    : ['action', 'accountId', 'intent', 'password'];
  if (Object.keys(body).some((key) => !fields.includes(key))) return null;
  if (!ownAccount && (typeof body.accountId !== 'string' || !body.accountId)) return null;
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
    const document = parseRequestDocument(intent.document);
    if (!document) return null;
    return {
      ...body,
      intent: { baseRevision: intent.baseRevision, document },
    } as ConfirmationRequest;
  } else if (Object.keys(intent).length !== 0) return null;
  return body as ConfirmationRequest;
}

export default class PasswordConfirmationsController {
  async password(ctx: HttpContext) {
    const body = requestBody(ctx.request.body());
    if (!body) return ctx.response.badRequest({ error: 'Invalid password confirmation.' });
    const accountId = body.accountId;
    if (accountId !== undefined) {
      await withActor(ctx, async (_actor, trx) => passwordConfirmationActor(accountId, trx));
    }
    const input = await accountInput(ctx);
    // A `delete-account` confirmation is scoped to the caller; `authorize` refuses any other scope.
    const scope = accountId ?? String(input.userId);
    const { confirmationId } = await passwordConfirmations.confirmPassword(input, {
      action: body.action,
      scope,
      intent: body.intent,
      password: body.password,
    });
    try {
      await passwordConfirmations.prune();
    } catch (error) {
      reportPrivateFailure(
        ctx,
        { event: 'password_confirmation.prune', errorType: classifyLogError(error) },
        'Password confirmation pruning failed'
      );
    }
    return ctx.response.ok({ confirmationId: confirmationId });
  }
}
