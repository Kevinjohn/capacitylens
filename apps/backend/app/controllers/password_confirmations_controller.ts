// The wire names are `POST /api/auth/password-confirmation`, `confirmationId`,
// `PASSWORD_CONFIRMATION_REQUIRED` and `PASSWORD_CONFIRMATION_DENIED`.
//
// Confirmations are pruned globally after successful issuance, outside every transaction; a pruning
// failure cannot fail the issuance response.

import type { HttpContext } from '@adonisjs/core/http';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { requirePasswordConfirmationActor } from '#services/auth/password_confirmation';
import { withActor } from '#services/auth/current_actor';
import { classifyLogError } from '#config/logger';
import { parseRequestDocument } from '#services/company_import';
import { confirmPasswordValidator } from '#validators/password_confirmations';

export default class PasswordConfirmationsController {
  async store({ auth, request, response, logger, serialize }: HttpContext) {
    const body = await request.validateUsing(confirmPasswordValidator, {
      data: request.body(),
    });
    let intent: unknown = body.intent;
    if (body.action === 'import') {
      const document = parseRequestDocument(body.intent.document);
      if (!document) return response.badRequest({ error: 'Invalid password confirmation.' });
      intent = { baseRevision: body.intent.baseRevision, document };
    }
    await withActor(auth, async (_actor, trx) =>
      requirePasswordConfirmationActor(body.companyId, trx, body.action)
    );
    const { confirmationId } = await passwordConfirmations.confirmPassword(
      await auth.use('web').current(),
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
      logger.error(
        { event: 'password_confirmation.prune', errorType: classifyLogError(error) },
        'Password confirmation pruning failed'
      );
    }
    return serialize({ confirmationId });
  }
}
