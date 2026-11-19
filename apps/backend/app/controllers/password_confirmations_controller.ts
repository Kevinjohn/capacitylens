// The wire names are `POST /api/auth/password-confirmation`, `confirmationId`,
// `PASSWORD_CONFIRMATION_REQUIRED` and `PASSWORD_CONFIRMATION_DENIED`.
//
// Confirmations are pruned globally after successful issuance, outside every transaction; a pruning
// failure cannot fail the issuance response.

import type { HttpContext } from '@adonisjs/core/http';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { requirePasswordConfirmationActor } from '#services/auth/password_confirmation';
import { withActor } from '#services/auth/current_actor';
import { classifyLogError, reportPrivateFailure } from '#services/logging_safety';
import { parseRequestDocument } from '#services/company_import';
import { managedGuard } from '#services/auth/managed_guard';
import { passwordValidator } from '#validators/password_confirmations';

export default class PasswordConfirmationsController {
  async password(ctx: HttpContext) {
    const body = await ctx.request.validateUsing(passwordValidator, { data: ctx.request.body() });
    let intent: unknown = body.intent;
    if (body.action === 'import') {
      const document = parseRequestDocument(body.intent.document);
      if (!document) return ctx.response.badRequest({ error: 'Invalid password confirmation.' });
      intent = { baseRevision: body.intent.baseRevision, document };
    }
    await withActor(ctx, async (_actor, trx) =>
      requirePasswordConfirmationActor(body.companyId, trx, body.action)
    );
    const { confirmationId } = await passwordConfirmations.confirmPassword(
      await managedGuard.current(ctx),
      {
        action: body.action,
        scope: body.companyId,
        intent,
        password: body.password,
      }
    );
    try {
      await passwordConfirmations.prune();
    } catch (error) {
      // Does work: pruning is best effort, so its failure is logged and the confirmation stands.
      reportPrivateFailure(
        ctx,
        { event: 'password_confirmation.prune', errorType: classifyLogError(error) },
        'Password confirmation pruning failed'
      );
    }
    return ctx.response.ok({ confirmationId });
  }
}
