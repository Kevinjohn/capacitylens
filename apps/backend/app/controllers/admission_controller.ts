import type { HttpContext } from '@adonisjs/core/http';
import app from '@adonisjs/core/services/app';
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission';
import { readCurrentAccount, withActor } from '#services/auth/current_actor';
import { completeMembership } from '#services/membership/admission_membership';

import { admissionQueryValidator } from '#validators/admission_query';
import { errors as vineErrors } from '@vinejs/vine';
import { managedGuard } from '#services/auth/managed_guard';
import { USER_ID_PATTERN } from '#services/request_helpers';

const resolveAdmission = () => app.container.make(AccountAdmission);

function parseUserIdParam(value: unknown) {
  return typeof value === 'string' && USER_ID_PATTERN.test(value) ? value : null;
}

/**
 * The caller's own admission status and request, reachable before admission, and the Owner and
 * Admin decisions. The Account Kit authorises every decision; it sends no notification.
 */
export default class AdmissionController {
  async show(ctx: HttpContext) {
    const service = await resolveAdmission();
    const { decision } = await service.current(await managedGuard.current(ctx));
    return ctx.response.ok({ decision });
  }

  async request(ctx: HttpContext) {
    const service = await resolveAdmission();
    const record = await service.request(await managedGuard.current(ctx));
    return ctx.response.ok({ requestedAt: record.requestedAt });
  }

  async index(ctx: HttpContext) {
    let query;
    try {
      query = await ctx.request.validateUsing(admissionQueryValidator, { data: ctx.request.qs() });
    } catch (error) {
      // Route wording: this list answers a Vine failure with its own sentence and no code.
      if (!(error instanceof vineErrors.E_VALIDATION_ERROR)) throw error;
      return ctx.response.badRequest({ error: 'Invalid admission list request.' });
    }
    const { status, cursor } = query;
    const actor = await readCurrentAccount(ctx);
    const service = await resolveAdmission();
    const page = await service.list({ actorId: actor.id, status, cursor, limit: 100 });
    return ctx.response.ok(page);
  }

  async approve(ctx: HttpContext) {
    return this.decide(ctx, 'approve');
  }

  async reject(ctx: HttpContext) {
    return this.decide(ctx, 'reject');
  }

  async revoke(ctx: HttpContext) {
    return this.decide(ctx, 'revoke');
  }

  /** Creates the admitted caller's missing membership; never reactivates or changes one. */
  async complete(ctx: HttpContext) {
    const result = await withActor(ctx, (actor, trx) => completeMembership(actor.userId, trx));
    return ctx.response.ok(result);
  }

  private async decide(ctx: HttpContext, decision: 'approve' | 'reject' | 'revoke') {
    const userId = parseUserIdParam(ctx.params.userId);
    if (!userId) return ctx.response.badRequest({ error: 'Invalid admission request.' });
    const actor = await readCurrentAccount(ctx);
    const service = await resolveAdmission();
    const record = await service[decision]({ actorId: actor.id, userId });
    return ctx.response.ok({ userId: String(record.userId), approval: record.approval });
  }
}
