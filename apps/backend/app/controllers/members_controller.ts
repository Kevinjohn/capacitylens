import type { HttpContext } from '@adonisjs/core/http';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { isAccountRole, isMembershipStatus } from '@capacitylens/shared/account/types';
import { assertCompanyAction } from '#services/auth/authorization';
import { withActor } from '#services/auth/current_actor';
import { runAccountCommand, parseAccountCommand } from '#services/account_commands';
import { hasOnlyFields } from '#services/request_helpers';
import { changeMemberRole, changeMemberStatus } from '#services/membership/member_mutations';
import { changeMemberSignInTracking } from '#services/membership/sign_in_tracking';
import { readMemberDirectory } from '#services/membership/member_directory';

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

async function semanticMutation<T>(ctx: HttpContext, input: SemanticMutationInput<T>) {
  const { companyId, operation, payload, work } = input;
  const command = parseAccountCommand(
    ctx.request.header('x-account-command-id'),
    ctx.request.header('idempotency-key')
  );
  return withActor(ctx, async (currentActor, trx) => {
    let actor: Awaited<ReturnType<typeof assertCompanyAction>>;
    return runAccountCommand(trx, {
      name: operation,
      authorizeAccess: async () => {
        actor = await assertCompanyAction(companyId, 'members:manage', trx);
      },
      work: () => work(trx, actor),
      actorId: currentActor.userId,
      scopeId: companyId,
      payload,
      command,
    });
  });
}

/** Lists company members and applies member commands under live management authority. */
export default class MembersController {
  async index(ctx: HttpContext) {
    const companyId = readRouteParam(ctx.params.companyId);
    const directory = await withActor(ctx, async (_actor, trx) => {
      const actor = await assertCompanyAction(companyId, 'members:manage', trx);
      return readMemberDirectory(trx, companyId, actor);
    });
    return ctx.response.ok(directory);
  }

  async tracking(ctx: HttpContext) {
    const body: unknown = ctx.request.body();
    if (!hasOnlyFields(body, ['enabled']) || typeof body.enabled !== 'boolean') {
      return ctx.response.badRequest({ error: 'enabled must be a Boolean.' });
    }
    const enabled = body.enabled;
    const companyId = readRouteParam(ctx.params.companyId);
    await withActor(ctx, async (_actor, trx) => {
      const actor = await assertCompanyAction(companyId, 'members:signInTracking', trx);
      await changeMemberSignInTracking(trx, { companyId, actorId: actor.actorId, enabled });
    });
    return ctx.response.ok({ enabled });
  }

  async changeRole(ctx: HttpContext) {
    const body: unknown = ctx.request.body();
    if (!hasOnlyFields(body, ['role']) || !isAccountRole(body.role)) {
      return ctx.response.badRequest({ error: 'Invalid member role.' });
    }
    const role = body.role;
    const companyId = readRouteParam(ctx.params.companyId);
    const userId = readRouteParam(ctx.params.userId);
    const result = await semanticMutation(ctx, {
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
    const body: unknown = ctx.request.body();
    if (!hasOnlyFields(body, ['status']) || !isMembershipStatus(body.status)) {
      return ctx.response.badRequest({ error: 'Invalid member status.' });
    }
    const status = body.status;
    const companyId = readRouteParam(ctx.params.companyId);
    const userId = readRouteParam(ctx.params.userId);
    const result = await semanticMutation(ctx, {
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
