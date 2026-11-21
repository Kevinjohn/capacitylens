import type { HttpContext } from '@adonisjs/core/http';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { assertCompanyPermission } from '#services/auth/authorization';
import { withActor } from '#services/auth/current_actor';
import { runAccountOperation, parseAccountOperation } from '#services/account_operations';
import { changeMemberRole, changeMemberStatus } from '#services/membership/member_mutations';
import { changeMemberSignInTracking } from '#services/membership/sign_in_tracking';
import { readMemberDirectory } from '#services/membership/member_directory';
import { changeRoleValidator, changeStatusValidator, trackingValidator } from '#validators/members';

function readRouteParam(value: unknown) {
  // Adonis calls the controller after matching a route, so each parameter is already a string.
  return value as string;
}

interface SemanticMutationInput<T> {
  companyId: string;
  operation: string;
  payload: unknown;
  work: (trx: TransactionClientContract, actor: { actorId: string }) => Promise<T>;
}

async function runMemberMutation<T>(ctx: HttpContext, input: SemanticMutationInput<T>) {
  const { companyId, operation, payload, work } = input;
  const command = parseAccountOperation(
    ctx.request.header('x-account-command-id'),
    ctx.request.header('idempotency-key')
  );
  return withActor(ctx, async (currentActor, trx) => {
    let actor: Awaited<ReturnType<typeof assertCompanyPermission>>;
    return runAccountOperation(trx, {
      name: operation,
      authorizeAccess: async () => {
        actor = await assertCompanyPermission(companyId, 'members:manage', trx);
      },
      work: () => work(trx, actor),
      actorId: currentActor.userId,
      scopeId: companyId,
      payload,
      command,
    });
  });
}

/** Lists company members and applies member operations under live management permission. */
export default class MembersController {
  async index(ctx: HttpContext) {
    const companyId = readRouteParam(ctx.params.companyId);
    const directory = await withActor(ctx, async (_actor, trx) => {
      const actor = await assertCompanyPermission(companyId, 'members:manage', trx);
      return readMemberDirectory(trx, companyId, actor);
    });
    return ctx.response.ok(directory);
  }

  async tracking(ctx: HttpContext) {
    const { enabled } = await ctx.request.validateUsing(trackingValidator, {
      data: ctx.request.body(),
    });
    const companyId = readRouteParam(ctx.params.companyId);
    await withActor(ctx, async (_actor, trx) => {
      const actor = await assertCompanyPermission(companyId, 'members:signInTracking', trx);
      await changeMemberSignInTracking(trx, { companyId, actorId: actor.actorId, enabled });
    });
    return ctx.response.ok({ enabled });
  }

  async changeRole(ctx: HttpContext) {
    const { role } = await ctx.request.validateUsing(changeRoleValidator, {
      data: ctx.request.body(),
    });
    const companyId = readRouteParam(ctx.params.companyId);
    const userId = readRouteParam(ctx.params.userId);
    const result = await runMemberMutation(ctx, {
      companyId,
      operation: 'change-member-role',
      payload: {
        userId,
        role,
      },
      work: (trx, actor) =>
        changeMemberRole(trx, {
          companyId,
          actorId: actor.actorId,
          userId,
          role,
        }),
    });
    return ctx.response.ok(result);
  }

  async changeStatus(ctx: HttpContext) {
    const { status } = await ctx.request.validateUsing(changeStatusValidator, {
      data: ctx.request.body(),
    });
    const companyId = readRouteParam(ctx.params.companyId);
    const userId = readRouteParam(ctx.params.userId);
    const result = await runMemberMutation(ctx, {
      companyId,
      operation: 'change-member-status',
      payload: {
        userId,
        status,
      },
      work: (trx, actor) =>
        changeMemberStatus(trx, {
          companyId,
          actorId: actor.actorId,
          userId,
          status,
        }),
    });
    return ctx.response.ok(result);
  }
}
