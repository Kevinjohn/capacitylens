import type { HttpContext } from '@adonisjs/core/http';
import db from '@adonisjs/lucid/services/db';
import { MasqueradeError } from '@kevinjohn/adonisjs-masquerade';
import { currentMasquerade, endMasquerade, startMasquerade } from '#services/auth/masquerade';
import { activeCompanyRole, IdentityAuthorityError } from '#services/auth/authorization';
import { InvalidSessionError } from '@kevinjohn/adonisjs-account-kit/errors';
import { hasOnlyFields } from '#services/request_helpers';
import { signedInSession } from '#services/auth/current_actor';

/** Package refusals reach the global handler's single mapping; only the authority refusal is reworded. */
async function respond<T>(ctx: HttpContext, work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof IdentityAuthorityError) {
      return ctx.response
        .status(error.status)
        .send({ error: 'This action is not allowed.', code: error.code });
    }
    throw error;
  }
}

export default class MasqueradeController {
  async start(ctx: HttpContext) {
    const accountId = ctx.params.accountId;
    const body: unknown = ctx.request.body();
    if (
      typeof accountId !== 'string' ||
      !accountId ||
      !hasOnlyFields(body, ['targetUserId']) ||
      typeof body.targetUserId !== 'string' ||
      !body.targetUserId
    ) {
      return ctx.response.badRequest({ error: 'Target member is required.' });
    }
    return respond(ctx, async () => {
      const started = await startMasquerade(
        ctx,
        body.targetUserId as string,
        ctx.request.header('X-Masquerade-Context') ?? ''
      );
      if (!started.isMasquerading) throw new MasqueradeError('E_MASQUERADE_UNAVAILABLE');
      return ctx.response.ok({
        ...(await currentMasquerade(ctx, db.connection(), accountId)),
        accountId,
      });
    });
  }

  async status(ctx: HttpContext) {
    return respond(ctx, async () => {
      try {
        const signIn = await signedInSession(ctx);
        if (!signIn) return ctx.response.ok({ active: false, contextToken: null });
        const input: unknown = ctx.request.input('accountId');
        const accountId = typeof input === 'string' && input ? input : undefined;
        if (accountId) {
          const mode = await currentMasquerade(ctx, db.connection(), accountId);
          if (mode.active) return ctx.response.ok(mode);
          if (!(await activeCompanyRole(signIn.userId, accountId, undefined))) {
            throw new IdentityAuthorityError('Company membership is unavailable.');
          }
          return ctx.response.ok({ ...mode, accountId });
        }
        return ctx.response.ok(await currentMasquerade(ctx, db.connection(), undefined));
      } catch (error) {
        if (error instanceof InvalidSessionError) {
          return ctx.response.ok({ active: false, contextToken: null });
        }
        throw error;
      }
    });
  }

  async end(ctx: HttpContext) {
    const body: unknown = ctx.request.body();
    if (
      !hasOnlyFields(body, ['token', 'reason']) ||
      typeof body.token !== 'string' ||
      !body.token ||
      (body.reason !== 'explicit' && body.reason !== 'account_switch')
    ) {
      return ctx.response.badRequest({ error: 'Invalid masquerade end request.' });
    }
    return respond(ctx, async () => {
      const header = ctx.request.header('X-Masquerade-Context');
      if (typeof header !== 'string' || !header) {
        throw new MasqueradeError('E_MASQUERADE_CONTEXT_REQUIRED');
      }
      if (header !== body.token) throw new MasqueradeError('E_MASQUERADE_CONTEXT_CHANGED');
      const mode = await endMasquerade(ctx, header);
      return ctx.response.ok({ active: false, contextToken: mode.contextToken });
    });
  }
}
