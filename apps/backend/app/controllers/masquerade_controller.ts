import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import db from '@adonisjs/lucid/services/db';
import { errors as masqueradeErrors } from '@kevinjohn/adonisjs-masquerade';
import { MasqueradeModeService } from '#services/auth/masquerade_mode_service';
import { AuthorizationService } from '#services/auth/authorization_service';
import IdentityAuthorizationException from '#exceptions/identity_authorization_exception';
import { E_ACCOUNT_KIT_INVALID_SESSION } from '@kevinjohn/adonisjs-account-kit/errors';
import { CurrentActorService } from '#services/auth/current_actor_service';
import {
  endMasqueradeValidator,
  showMasqueradeValidator,
  startMasqueradeValidator,
} from '#validators/masquerade';
import { requestData } from '#validators/request_rules';

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
    const body = await ctx.request.validateUsing(startMasqueradeValidator, {
      data: requestData(ctx.request, ctx.request.body()),
    });
    const { companyId } = body.params;
    const started = await this.#masqueradeModes.startMasquerade(
      ctx,
      body.targetUserId,
      body.headers['x-masquerade-context'] ?? ''
    );
    if (!started.isMasquerading) throw new masqueradeErrors.E_MASQUERADE_UNAVAILABLE();
    return ctx.serialize({
      ...(await this.#masqueradeModes.readCurrentMasquerade(ctx, db.connection(), companyId)),
      companyId,
    });
  }

  async show(ctx: HttpContext) {
    const { companyId } = await ctx.request.validateUsing(showMasqueradeValidator, {
      data: ctx.request.qs(),
    });
    try {
      const signIn = await this.#currentActor.getSignedInSession(ctx.auth, ctx.session);
      if (!signIn) return ctx.serialize({ active: false, masqueradeToken: null });
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
      data: requestData(ctx.request, ctx.request.body()),
    });
    const header = body.headers['x-masquerade-context'];
    if (!header) {
      throw new masqueradeErrors.E_MASQUERADE_CONTEXT_REQUIRED();
    }
    if (header !== body.token) throw new masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED();
    const mode = await this.#masqueradeModes.endMasquerade(ctx, header);
    return ctx.serialize({ active: false, masqueradeToken: mode.contextToken });
  }
}
