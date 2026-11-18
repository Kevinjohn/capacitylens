import type { HttpContext } from '@adonisjs/core/http';
import { CompanyDocumentError } from '@capacitylens/shared/data/companyDocument';
import { withActor, kitContextIn } from '#services/auth/current_actor';
import { passwordConfirmationActor } from '#services/auth/password_confirmation';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { hasOnlyFields } from '#services/request_helpers';
import { EntityWriteError } from '#services/planning/errors';
import {
  applyCompanyImport,
  parseRequestDocument,
  previewCompanyImport,
  readRequestDocument,
} from '#services/company_import';

function parseImportBody(value: unknown) {
  const expected = ['companyId', 'document', 'baseRevision'];
  const body = value;
  if (
    !hasOnlyFields(body, [...expected, 'confirmationId']) ||
    expected.some((key) => !Object.hasOwn(body, key))
  ) {
    return null;
  }
  if (typeof body.companyId !== 'string' || !body.companyId) return null;
  if (
    !Number.isSafeInteger(body.baseRevision) ||
    (body.baseRevision as number) < 0 ||
    (body.confirmationId !== undefined && typeof body.confirmationId !== 'string')
  ) {
    return null;
  }
  const document = parseRequestDocument(body.document);
  if (!document) return null;
  return {
    companyId: body.companyId,
    document,
    baseRevision: body.baseRevision as number,
    confirmationId: (body.confirmationId as string | undefined) ?? '',
  };
}

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
    const body = ctx.request.body();
    if (
      !hasOnlyFields(body, ['companyId', 'document']) ||
      !Object.hasOwn(body, 'document') ||
      typeof body.companyId !== 'string' ||
      !body.companyId
    ) {
      return ctx.response.badRequest({ error: 'Invalid beta transfer document.' });
    }
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
    const body = parseImportBody(ctx.request.body());
    if (!body) return ctx.response.badRequest({ error: 'Invalid beta transfer request.' });
    try {
      const result = await withActor(ctx, async (_actor, trx) => {
        const actor = await passwordConfirmationActor(body.companyId, trx, 'import');
        await passwordConfirmations.consume(kitContextIn(trx), {
          confirmationId: body.confirmationId,
          action: 'import',
          scope: body.companyId,
          intent: { baseRevision: body.baseRevision, document: body.document },
        });
        return applyCompanyImport(
          trx,
          body.companyId,
          body.document,
          body.baseRevision,
          actor.userId
        );
      });
      return ctx.response.ok(result);
    } catch (error) {
      return sendTransferFailure(ctx, error);
    }
  }
}
