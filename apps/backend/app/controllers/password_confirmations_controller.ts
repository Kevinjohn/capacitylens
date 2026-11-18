// The wire names are `POST /api/auth/password-confirmation`, `confirmationId`,
// `PASSWORD_CONFIRMATION_REQUIRED` and `PASSWORD_CONFIRMATION_DENIED`.
//
// Confirmations are pruned globally after successful issuance, outside every transaction; a pruning
// failure cannot fail the issuance response.

import type { HttpContext } from '@adonisjs/core/http';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import {
  PASSWORD_CONFIRMATION_KINDS,
  passwordConfirmationActor,
  type PasswordConfirmationKind,
} from '#services/auth/password_confirmation';
import { withActor } from '#services/auth/current_actor';
import { classifyLogError, reportPrivateFailure } from '#services/logging_safety';
import { hasOnlyFields } from '#services/request_helpers';
import { parseRequestDocument } from '#services/company_import';
import { managedGuard } from '#services/auth/managed_guard';

type ConfirmationRequest = {
  action: PasswordConfirmationKind;
  companyId: string;
  intent: unknown;
  password: string;
};

function requestBody(value: unknown): ConfirmationRequest | null {
  const body = value;
  if (!hasOnlyFields(body, ['action', 'companyId', 'intent', 'password'])) return null;
  if (!PASSWORD_CONFIRMATION_KINDS.includes(body.action as PasswordConfirmationKind)) return null;
  if (typeof body.companyId !== 'string' || !body.companyId) return null;
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
    await withActor(ctx, async (_actor, trx) =>
      passwordConfirmationActor(body.companyId, trx, body.action)
    );
    const { confirmationId } = await passwordConfirmations.confirmPassword(
      await managedGuard.current(ctx),
      {
        action: body.action,
        scope: body.companyId,
        intent: body.intent,
        password: body.password,
      }
    );
    try {
      await passwordConfirmations.prune();
    } catch (error) {
      reportPrivateFailure(
        ctx,
        { event: 'password_confirmation.prune', errorType: classifyLogError(error) },
        'Password confirmation pruning failed'
      );
    }
    return ctx.response.ok({ confirmationId });
  }
}
