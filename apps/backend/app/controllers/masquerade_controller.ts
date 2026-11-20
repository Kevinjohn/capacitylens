import type { HttpContext } from '@adonisjs/core/http';
import db from '@adonisjs/lucid/services/db';
import { MasqueradeError } from '@kevinjohn/adonisjs-masquerade';
import { readCurrentMasquerade, endMasquerade, startMasquerade } from '#services/auth/masquerade';
import { getActiveCompanyRole, IdentityAuthorityError } from '#services/auth/authorization';
import { InvalidSessionError } from '@kevinjohn/adonisjs-account-kit/errors';
import { getSignedInSession } from '#services/auth/current_actor';
import { endValidator, startValidator } from '#validators/masquerade';

/** Package refusals reach the global handler's single mapping; only the authority refusal is reworded. */
async function runWithAuthorityRefusal<T>(ctx: HttpContext, work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    // Route wording: view-as controls refuse identity failures with their own sentence.
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
    const companyId = ctx.params.companyId;
    if (typeof companyId !== 'string' || !companyId) {
      return ctx.response.badRequest({ error: 'Target member is required.' });
    }
    const body = await ctx.request.validateUsing(startValidator, { data: ctx.request.body() });
    return runWithAuthorityRefusal(ctx, async () => {
      const started = await startMasquerade(
        ctx,
        body.targetUserId,
        ctx.request.header('X-Masquerade-Context') ?? ''
      );
      if (!started.isMasquerading) throw new MasqueradeError('E_MASQUERADE_UNAVAILABLE');
      return ctx.response.ok({
        ...(await readCurrentMasquerade(ctx, db.connection(), companyId)),
        companyId,
      });
    });
  }

  async status(ctx: HttpContext) {
    return runWithAuthorityRefusal(ctx, async () => {
      try {
        const signIn = await getSignedInSession(ctx);
        if (!signIn) return ctx.response.ok({ active: false, contextToken: null });
        const input: unknown = ctx.request.input('companyId');
        const companyId = typeof input === 'string' && input ? input : undefined;
        if (companyId) {
          const mode = await readCurrentMasquerade(ctx, db.connection(), companyId);
          if (mode.active) return ctx.response.ok(mode);
          if (!(await getActiveCompanyRole(signIn.userId, companyId, undefined))) {
            throw new IdentityAuthorityError('Company membership is unavailable.');
          }
          return ctx.response.ok({ ...mode, companyId });
        }
        return ctx.response.ok(await readCurrentMasquerade(ctx, db.connection(), undefined));
      } catch (error) {
        // Does work: no session is the inactive status, not a refusal.
        if (error instanceof InvalidSessionError) {
          return ctx.response.ok({ active: false, contextToken: null });
        }
        throw error;
      }
    });
  }

  async end(ctx: HttpContext) {
    const body = await ctx.request.validateUsing(endValidator, { data: ctx.request.body() });
    return runWithAuthorityRefusal(ctx, async () => {
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
