import type { HttpContext } from '@adonisjs/core/http';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { Role } from '@capacitylens/shared/account/types';
import { isAccountRole, isMembershipStatus } from '@capacitylens/shared/account/types';
import { assertCompanyAction } from '#services/auth/authorization';
import { withActor } from '#services/auth/current_actor';
import { writeAudit } from '#services/audit';
import {
  AccountCommandError,
  claimAccountCommand,
  completeAccountCommand,
  readAccountCommand,
} from '#services/account_commands';
import {
  changeMemberRole,
  changeMemberStatus,
  enableMemberAccess,
  MembershipError,
  removeMember,
} from '#services/membership/member_mutations';
import {
  confirmMemberSignIn,
  readMemberSignInTracking,
  setMemberSignInTracking,
} from '#services/membership/sign_in_tracking';
import { readMemberDirectory } from '#services/membership/member_directory';

function fields(value: unknown, allowed: string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key))
  );
}

function readRouteParam(value: unknown) {
  // Adonis calls the controller after matching a route, so each parameter is already a string.
  return value as string;
}

function replyMemberError(ctx: HttpContext, error: unknown) {
  if (error instanceof MembershipError || error instanceof AccountCommandError) {
    return ctx.response.status(error.status).send({ error: error.message, code: error.code });
  }
  throw error;
}

interface SemanticMutationInput<T> {
  accountId: string;
  operation: string;
  payload: unknown;
  work: (trx: TransactionClientContract, actor: { actorId: string; role: Role }) => Promise<T>;
}

async function semanticMutation<T>(ctx: HttpContext, input: SemanticMutationInput<T>) {
  const { accountId, operation, payload, work } = input;
  const command = readAccountCommand(ctx);
  return withActor(ctx, async (_actor, trx) => {
    const actor = await assertCompanyAction(accountId, 'manageMembers', trx);
    const claim = await claimAccountCommand(trx, {
      accountId,
      actorId: actor.actorId,
      operation,
      payload,
      command,
      kind: 'semantic',
    });
    if (claim.replayed) {
      // The claim binds company, actor, operation and payload to this operation's stored result.
      return claim.result as T;
    }
    const result = await work(trx, actor);
    await completeAccountCommand(trx, command.commandId, result);
    return result;
  });
}

/** Lists company members and applies member commands under live management authority. */
export default class MembersController {
  async index(ctx: HttpContext) {
    const accountId = readRouteParam(ctx.params.accountId);
    const directory = await withActor(ctx, async (_actor, trx) => {
      const actor = await assertCompanyAction(accountId, 'manageMembers', trx);
      return readMemberDirectory(trx, accountId, actor.actorId);
    });
    return ctx.response.ok(directory);
  }

  async tracking(ctx: HttpContext) {
    const body: unknown = ctx.request.body();
    if (!fields(body, ['enabled']) || typeof body.enabled !== 'boolean') {
      return ctx.response.badRequest({ error: 'enabled must be a Boolean.' });
    }
    const enabled = body.enabled;
    const accountId = readRouteParam(ctx.params.accountId);
    await withActor(ctx, async (_actor, trx) => {
      const actor = await assertCompanyAction(accountId, 'manageMemberSignInTracking', trx);
      const current = await readMemberSignInTracking(accountId, trx);
      await setMemberSignInTracking(accountId, enabled, trx);
      if (!current.enabled && enabled) await confirmMemberSignIn(accountId, actor.actorId, trx);
      if (current.enabled !== enabled) {
        await writeAudit(trx, {
          accountId,
          actorId: actor.actorId,
          action: 'memberSignInTrackingChange',
          entity: 'account',
          entityId: accountId,
          fields: ['memberSignInTracking'],
        });
      }
    });
    return ctx.response.ok({ enabled });
  }

  async changeRole(ctx: HttpContext) {
    const body: unknown = ctx.request.body();
    if (!fields(body, ['role']) || !isAccountRole(body.role)) {
      return ctx.response.badRequest({ error: 'Invalid member role.' });
    }
    const role = body.role;
    const accountId = readRouteParam(ctx.params.accountId);
    const userId = readRouteParam(ctx.params.userId);
    try {
      const result = await semanticMutation(ctx, {
        accountId,
        operation: 'change-member-role',
        payload: {
          userId,
          role,
        },
        work: (trx, actor) =>
          changeMemberRole(trx, {
            accountId,
            actorId: actor.actorId,
            actorRole: actor.role,
            userId,
            role,
          }),
      });
      return ctx.response.ok(result);
    } catch (error) {
      // Domain and receipt refusals retain their status; unexpected failures escape the mapper.
      return replyMemberError(ctx, error);
    }
  }

  async changeStatus(ctx: HttpContext) {
    const body: unknown = ctx.request.body();
    if (!fields(body, ['status']) || !isMembershipStatus(body.status)) {
      return ctx.response.badRequest({ error: 'Invalid member status.' });
    }
    const status = body.status;
    const accountId = readRouteParam(ctx.params.accountId);
    const userId = readRouteParam(ctx.params.userId);
    try {
      const result = await semanticMutation(ctx, {
        accountId,
        operation: 'change-member-status',
        payload: {
          userId,
          status,
        },
        work: (trx, actor) =>
          changeMemberStatus(trx, {
            accountId,
            actorId: actor.actorId,
            actorRole: actor.role,
            userId,
            status,
          }),
      });
      return ctx.response.ok(result);
    } catch (error) {
      // Domain and receipt refusals retain their status; unexpected failures escape the mapper.
      return replyMemberError(ctx, error);
    }
  }

  async enableAccess(ctx: HttpContext) {
    const accountId = readRouteParam(ctx.params.accountId);
    const userId = readRouteParam(ctx.params.userId);
    try {
      const result = await semanticMutation(ctx, {
        accountId,
        operation: 'enable-member-access',
        payload: { userId },
        work: (trx, actor) =>
          enableMemberAccess(trx, {
            accountId,
            actorId: actor.actorId,
            actorRole: actor.role,
            userId,
          }),
      });
      return ctx.response.ok(result);
    } catch (error) {
      // Domain and receipt refusals retain their status; unexpected failures escape the mapper.
      return replyMemberError(ctx, error);
    }
  }

  async remove(ctx: HttpContext) {
    const accountId = readRouteParam(ctx.params.accountId);
    const userId = readRouteParam(ctx.params.userId);
    try {
      await semanticMutation(ctx, {
        accountId,
        operation: 'remove-member',
        payload: { userId },
        work: (trx, actor) =>
          removeMember(trx, {
            accountId,
            actorId: actor.actorId,
            actorRole: actor.role,
            userId,
          }),
      });
      return ctx.response.noContent();
    } catch (error) {
      // Domain and receipt refusals retain their status; unexpected failures escape the mapper.
      return replyMemberError(ctx, error);
    }
  }
}
