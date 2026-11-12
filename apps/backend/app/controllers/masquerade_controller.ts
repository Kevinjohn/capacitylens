import type { HttpContext } from '@adonisjs/core/http';
import { MasqueradeError } from '@kevinjohn/adonisjs-masquerade';
import { currentMasquerade, endMasquerade, startMasquerade } from '#services/auth/masquerade';
import { activeCompanyRole, IdentityAuthorityError } from '#services/auth/authorization';
import { InvalidSessionError } from '@kevinjohn/adonisjs-account-kit/errors';
import { hasOnlyFields } from '#services/request_helpers';
import { signedInSession } from '#services/auth/current_actor';

async function respond<T>(ctx: HttpContext, work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MasqueradeError) {
      const status = error.code === 'E_MASQUERADE_INVALID_INPUT' ? 400 : error.status;
      const code =
        error.code === 'E_MASQUERADE_CONTEXT_REQUIRED'
          ? 'MASQUERADE_CONTEXT_REQUIRED'
          : error.code === 'E_MASQUERADE_CONTEXT_CHANGED'
            ? 'MASQUERADE_CONTEXT_CHANGED'
            : error.code === 'E_MASQUERADE_ACTION_BLOCKED'
              ? 'MASQUERADE_READ_ONLY'
              : error.code === 'E_MASQUERADE_INVALID_INPUT'
                ? 'VALIDATION_ERROR'
                : error.code;
      return ctx.response.status(status).send({ error: error.message, code });
    }
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
      const started = await startMasquerade(ctx, body.targetUserId as string);
      if (!started.isMasquerading) throw new MasqueradeError('E_MASQUERADE_UNAVAILABLE');
      return ctx.response.ok({
        ...(await currentMasquerade(ctx)),
        accountId,
      });
    });
  }

  async status(ctx: HttpContext) {
    return respond(ctx, async () => {
      try {
        const signIn = await signedInSession(ctx);
        if (!signIn) return ctx.response.ok({ active: false, contextToken: null });
        const accountId = ctx.request.input('accountId');
        if (typeof accountId === 'string' && accountId) {
          const mode = await currentMasquerade(ctx);
          if (mode.active) return ctx.response.ok(mode);
          if (!(await activeCompanyRole(signIn.userId, accountId, undefined))) {
            throw new IdentityAuthorityError('Company membership is unavailable.');
          }
          return ctx.response.ok({ ...mode, accountId });
        }
        return ctx.response.ok(await currentMasquerade(ctx));
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
      const mode = await endMasquerade(ctx);
      return ctx.response.ok({ active: false, contextToken: mode.contextToken });
    });
  }
}
