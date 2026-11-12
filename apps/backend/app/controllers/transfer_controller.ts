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
} from '#services/beta_account_transfer';

function input(value: unknown, apply: boolean) {
  const expected = apply ? ['accountId', 'document', 'baseRevision'] : ['accountId', 'document'];
  const body = value;
  if (
    !hasOnlyFields(body, apply ? [...expected, 'confirmationId'] : expected) ||
    expected.some((key) => !Object.hasOwn(body, key))
  ) {
    return null;
  }
  if (typeof body.accountId !== 'string' || !body.accountId) return null;
  if (
    apply &&
    (!Number.isSafeInteger(body.baseRevision) ||
      (body.baseRevision as number) < 0 ||
      (body.confirmationId !== undefined && typeof body.confirmationId !== 'string'))
  ) {
    return null;
  }
  const document = parseRequestDocument(body.document);
  if (!document) return null;
  return {
    accountId: body.accountId as string,
    document,
    baseRevision: apply ? (body.baseRevision as number) : undefined,
    confirmationId: apply ? ((body.confirmationId as string | undefined) ?? '') : undefined,
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
    const body = input(ctx.request.body(), false);
    if (!body) return ctx.response.badRequest({ error: 'Invalid beta transfer document.' });
    try {
      const result = await withActor(ctx, async (_actor, trx) => {
        await passwordConfirmationActor(body.accountId as string, trx);
        return previewBetaAccountTransfer(trx, body.accountId as string, body.document);
      });
      return ctx.response.ok(result);
    } catch (error) {
      return failure(ctx, error);
    }
  }

  async apply(ctx: HttpContext) {
    const body = input(ctx.request.body(), true);
    if (!body) return ctx.response.badRequest({ error: 'Invalid beta transfer request.' });
    try {
      const result = await withActor(ctx, async (_actor, trx) => {
        const actor = await passwordConfirmationActor(body.accountId as string, trx);
        await passwordConfirmations.consume(kitContextIn(trx), {
          confirmationId: body.confirmationId as string,
          action: 'import',
          scope: body.accountId as string,
          intent: { baseRevision: body.baseRevision, document: body.document },
        });
        return applyBetaAccountTransfer(
          trx,
          body.accountId as string,
          body.document,
          body.baseRevision as number,
          actor.userId
        );
      });
      return ctx.response.ok(result);
    } catch (error) {
      return failure(ctx, error);
    }
  }
}
