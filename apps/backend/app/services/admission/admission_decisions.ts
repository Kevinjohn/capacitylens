import type { HttpContext } from '@adonisjs/core/http';
import app from '@adonisjs/core/services/app';
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission';
import { readCurrentAccount } from '#services/auth/current_actor';
import { USER_ID_PATTERN } from '#services/request_helpers';

/** Resolves the Account Kit's admission service from the container. */
export const resolveAdmission = () => app.container.make(AccountAdmission);

/** Reads an admission route's user id, or `null` when it is not an account identity id. */
export function parseUserIdParam(value: unknown) {
  return typeof value === 'string' && USER_ID_PATTERN.test(value) ? value : null;
}

/** Applies an Owner or Admin admission decision to the route's user. */
export async function decideAdmission(ctx: HttpContext, decision: 'approve' | 'reject' | 'revoke') {
  const userId = parseUserIdParam(ctx.params.userId);
  if (!userId) return ctx.response.badRequest({ error: 'Invalid admission request.' });
  const actor = await readCurrentAccount(ctx);
  const service = await resolveAdmission();
  const record = await service[decision]({ actorId: actor.id, userId });
  return ctx.response.ok({ userId: String(record.userId), approval: record.approval });
}
