import type { HttpContext } from '@adonisjs/core/http';
import { BetaTransferError } from '@capacitylens/shared/data/betaTransfer';
import { withActor, kitContextIn } from '#services/auth/current_actor';
import { passwordConfirmationActor } from '#services/auth/password_confirmation';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { hasOnlyFields } from '#services/request_helpers';
import { EntityWriteError } from '#services/planning/errors';
import {
  applyBetaAccountTransfer,
  parseRequestDocument,
  previewBetaAccountTransfer,
  readRequestDocument,
} from '#services/beta_account_transfer';

function input(value: unknown) {
  const expected = ['accountId', 'document', 'baseRevision'];
  const body = value;
  if (
    !hasOnlyFields(body, [...expected, 'confirmationId']) ||
    expected.some((key) => !Object.hasOwn(body, key))
  ) {
    return null;
  }
  if (typeof body.accountId !== 'string' || !body.accountId) return null;
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
    accountId: body.accountId,
    document,
    baseRevision: body.baseRevision as number,
    confirmationId: (body.confirmationId as string | undefined) ?? '',
  };
}

function failure(ctx: HttpContext, error: unknown) {
  if (error instanceof EntityWriteError) {
    return ctx.response.status(error.status).send({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.current ?? {}),
    });
  }
  if (error instanceof BetaTransferError) return ctx.response.badRequest({ error: error.message });
  throw error;
}

export default class TransferController {
  async preview(ctx: HttpContext) {
    const body = ctx.request.body();
    if (
      !hasOnlyFields(body, ['accountId', 'document']) ||
      !Object.hasOwn(body, 'document') ||
      typeof body.accountId !== 'string' ||
      !body.accountId
    ) {
      return ctx.response.badRequest({ error: 'Invalid beta transfer document.' });
    }
    const accountId = body.accountId;
    try {
      // The preview names why a document is refused, so the browser never validates it itself.
      const document = readRequestDocument(body.document);
      const result = await withActor(ctx, async (_actor, trx) => {
        await passwordConfirmationActor(accountId, trx, 'import');
        return previewBetaAccountTransfer(trx, accountId, document);
      });
      return ctx.response.ok(result);
    } catch (error) {
      return failure(ctx, error);
    }
  }

  async apply(ctx: HttpContext) {
    const body = input(ctx.request.body());
    if (!body) return ctx.response.badRequest({ error: 'Invalid beta transfer request.' });
    try {
      const result = await withActor(ctx, async (_actor, trx) => {
        const actor = await passwordConfirmationActor(body.accountId, trx, 'import');
        await passwordConfirmations.consume(kitContextIn(trx), {
          confirmationId: body.confirmationId,
          action: 'import',
          scope: body.accountId,
          intent: { baseRevision: body.baseRevision, document: body.document },
        });
        return applyBetaAccountTransfer(
          trx,
          body.accountId,
          body.document,
          body.baseRevision,
          actor.userId
        );
      });
      return ctx.response.ok(result);
    } catch (error) {
      return failure(ctx, error);
    }
  }
}
