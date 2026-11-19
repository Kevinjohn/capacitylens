import type { HttpContext } from '@adonisjs/core/http';
import { CompanyDocumentError } from '@capacitylens/shared/data/companyDocument';
import { withActor, kitContextIn } from '#services/auth/current_actor';
import { passwordConfirmationActor } from '#services/auth/password_confirmation';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { EntityWriteError } from '#services/planning/errors';
import {
  applyCompanyImport,
  parseRequestDocument,
  previewCompanyImport,
  readRequestDocument,
} from '#services/company_import';
import { applyValidator, previewValidator } from '#validators/transfer';

function sendTransferFailure(ctx: HttpContext, error: unknown) {
  if (error instanceof EntityWriteError) {
    return ctx.response.status(error.status).send({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.current ?? {}),
    });
  }
  if (error instanceof CompanyDocumentError) {
    return ctx.response.badRequest({ error: error.message });
  }
  throw error;
}

export default class TransferController {
  async preview(ctx: HttpContext) {
    const body = await ctx.request.validateUsing(previewValidator, { data: ctx.request.body() });
    const companyId = body.companyId;
    try {
      // The preview names why a document is refused, so the browser never validates it itself.
      const document = readRequestDocument(body.document);
      const result = await withActor(ctx, async (_actor, trx) => {
        await passwordConfirmationActor(companyId, trx, 'import');
        return previewCompanyImport(trx, companyId, document);
      });
      return ctx.response.ok(result);
    } catch (error) {
      return sendTransferFailure(ctx, error);
    }
  }

  async apply(ctx: HttpContext) {
    const body = await ctx.request.validateUsing(applyValidator, { data: ctx.request.body() });
    const { companyId, baseRevision, confirmationId = '' } = body;
    const document = parseRequestDocument(body.document);
    if (!document) return ctx.response.badRequest({ error: 'Invalid beta transfer request.' });
    try {
      const result = await withActor(ctx, async (_actor, trx) => {
        const actor = await passwordConfirmationActor(companyId, trx, 'import');
        await passwordConfirmations.consume(kitContextIn(trx), {
          confirmationId,
          action: 'import',
          scope: companyId,
          intent: { baseRevision, document },
        });
        return applyCompanyImport(trx, companyId, document, baseRevision, actor.userId);
      });
      return ctx.response.ok(result);
    } catch (error) {
      return sendTransferFailure(ctx, error);
    }
  }
}
