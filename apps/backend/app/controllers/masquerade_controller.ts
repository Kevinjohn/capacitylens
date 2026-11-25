import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import db from '@adonisjs/lucid/services/db';
import { errors as masqueradeErrors } from '@kevinjohn/adonisjs-masquerade';
import { MasqueradeModeService } from '#services/auth/masquerade_mode_service';
import { AuthorizationService } from '#services/auth/authorization_service';
import { IdentityAuthorizationException } from '#exceptions/identity_authorization_exception';
import { E_ACCOUNT_KIT_INVALID_SESSION } from '@kevinjohn/adonisjs-account-kit/errors';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { endMasqueradeValidator, startMasqueradeValidator } from '#validators/masquerade';

@inject()
export default class MasqueradeController {
  #masqueradeModes: MasqueradeModeService;
  #authorization: AuthorizationService;
  #currentActor: CurrentActorService;

  constructor(
    masqueradeModes: MasqueradeModeService,
    authorization: AuthorizationService,
    currentActor: CurrentActorService
  ) {
    this.#masqueradeModes = masqueradeModes;
    this.#authorization = authorization;
    this.#currentActor = currentActor;
  }

  async store(ctx: HttpContext) {
    const companyId = ctx.params.companyId;
    if (typeof companyId !== 'string' || !companyId) {
      return ctx.response.badRequest({ error: 'Target member is required.' });
    }
    const body = await ctx.request.validateUsing(startMasqueradeValidator, {
      data: ctx.request.body(),
    });
    const started = await this.#masqueradeModes.startMasquerade(
      ctx,
      body.targetUserId,
      ctx.request.header('X-Masquerade-Context') ?? ''
    );
    if (!started.isMasquerading) throw new masqueradeErrors.E_MASQUERADE_UNAVAILABLE();
    return ctx.serialize({
      ...(await this.#masqueradeModes.readCurrentMasquerade(ctx, db.connection(), companyId)),
      companyId,
    });
  }

  async show(ctx: HttpContext) {
    try {
      const signIn = await this.#currentActor.getSignedInSession(ctx.auth, ctx.session);
      if (!signIn) return ctx.serialize({ active: false, masqueradeToken: null });
      const input: unknown = ctx.request.input('companyId');
      const companyId = typeof input === 'string' && input ? input : undefined;
      if (companyId) {
        const mode = await this.#masqueradeModes.readCurrentMasquerade(
          ctx,
          db.connection(),
          companyId
        );
        if (mode.active) return ctx.serialize(mode);
        if (
          !(await this.#authorization.getActiveCompanyRole(signIn.userId, companyId, undefined))
        ) {
          throw new IdentityAuthorizationException('Company membership is unavailable.');
        }
        return ctx.serialize({ ...mode, companyId });
      }
      return ctx.serialize(
        await this.#masqueradeModes.readCurrentMasquerade(ctx, db.connection(), undefined)
      );
    } catch (error) {
      // Does work: no session is the inactive status, not a refusal.
      if (error instanceof E_ACCOUNT_KIT_INVALID_SESSION) {
        return ctx.serialize({ active: false, masqueradeToken: null });
      }
      throw error;
    }
  }

  async destroy(ctx: HttpContext) {
    const body = await ctx.request.validateUsing(endMasqueradeValidator, {
      data: ctx.request.body(),
    });
    const header = ctx.request.header('X-Masquerade-Context');
    if (typeof header !== 'string' || !header) {
      throw new masqueradeErrors.E_MASQUERADE_CONTEXT_REQUIRED();
    }
    if (header !== body.token) throw new masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED();
    const mode = await this.#masqueradeModes.endMasquerade(ctx, header);
    return ctx.serialize({ active: false, masqueradeToken: mode.contextToken });
  }
}
