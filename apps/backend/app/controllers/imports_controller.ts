import type { HttpContext } from '@adonisjs/core/http';
import { withActor, requireKitContext } from '#services/auth/current_actor';
import { requirePasswordConfirmationActor } from '#services/auth/password_confirmation';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { applyCompanyImport, parseRequestDocument } from '#services/company_import';
import { applyImportValidator } from '#validators/transfer';

/** Imports a company document after a password confirmation. */
export default class ImportsController {
  async store(ctx: HttpContext) {
    const body = await ctx.request.validateUsing(applyImportValidator, {
      data: ctx.request.body(),
    });
    const { companyId, baseRevision, confirmationId = '' } = body;
    const document = parseRequestDocument(body.document);
    if (!document) return ctx.response.badRequest({ error: 'Invalid beta transfer request.' });
    const result = await withActor(ctx, async (_actor, trx) => {
      const actor = await requirePasswordConfirmationActor(companyId, trx, 'import');
      await passwordConfirmations.consume(requireKitContext(trx), {
        confirmationId,
        action: 'import',
        scope: companyId,
        intent: { baseRevision, document },
      });
      return applyCompanyImport(trx, companyId, document, baseRevision, actor.userId);
    });
    return ctx.serialize(result);
  }
}
