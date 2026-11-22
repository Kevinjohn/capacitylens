import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';
import { requirePasswordConfirmationActor } from '#services/auth/password_confirmation';
import { previewCompanyImport, readRequestDocument } from '#services/company_import';
import { previewImportValidator } from '#validators/transfer';

/** Previews what importing a company document would change. */
export default class ImportPreviewsController {
  async store(ctx: HttpContext) {
    const body = await ctx.request.validateUsing(previewImportValidator, {
      data: ctx.request.body(),
    });
    const companyId = body.companyId;
    // The preview names why a document is refused, so the browser never validates it itself.
    const document = readRequestDocument(body.document);
    const result = await withActor(ctx, async (_actor, trx) => {
      await requirePasswordConfirmationActor(companyId, trx, 'import');
      return previewCompanyImport(trx, companyId, document);
    });
    return ctx.serialize(result);
  }
}
