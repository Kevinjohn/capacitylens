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

function replyMemberError(ctx: HttpContext, error: unknown) {
  if (error instanceof MembershipError || error instanceof AccountCommandError) {
    return ctx.response.status(error.status).send({ error: error.message, code: error.code });
  }
  throw error;
}

async function semanticMutation<T>(
  ctx: HttpContext,
  operation: string,
  payload: unknown,
  work: (trx: TransactionClientContract, actor: { actorId: string; role: Role }) => Promise<T>
) {
  const command = readAccountCommand(ctx);
  const accountId = ctx.params.accountId;
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
    if (claim.replayed) return claim.result as T;
    const result = await work(trx, actor);
    await completeAccountCommand(trx, command.commandId, result);
    return result;
  });
}

export default class MembersController {
  async index(ctx: HttpContext) {
    const accountId = ctx.params.accountId;
    const directory = await withActor(ctx, async (_actor, trx) => {
      const actor = await assertCompanyAction(accountId, 'manageMembers', trx);
      return readMemberDirectory(trx, accountId, actor.actorId);
    });
    return ctx.response.ok(directory);
  }

  async tracking(ctx: HttpContext) {
    if (
      !fields(ctx.request.body(), ['enabled']) ||
      typeof ctx.request.body().enabled !== 'boolean'
    ) {
      return ctx.response.badRequest({ error: 'enabled must be a Boolean.' });
    }
    const enabled = ctx.request.body().enabled as boolean;
    const accountId = ctx.params.accountId;
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
    try {
      const result = await semanticMutation(
        ctx,
        'change-member-role',
        {
          userId: ctx.params.userId,
          role: body.role,
        },
        (trx, actor) =>
          changeMemberRole(trx, {
            accountId: ctx.params.accountId,
            actorId: actor.actorId,
            actorRole: actor.role,
            userId: ctx.params.userId,
            role: body.role as Role,
          })
      );
      return ctx.response.ok(result);
    } catch (error) {
      return replyMemberError(ctx, error);
    }
  }

  async changeStatus(ctx: HttpContext) {
    const body: unknown = ctx.request.body();
    if (!fields(body, ['status']) || !isMembershipStatus(body.status)) {
      return ctx.response.badRequest({ error: 'Invalid member status.' });
    }
    try {
      const result = await semanticMutation(
        ctx,
        'change-member-status',
        {
          userId: ctx.params.userId,
          status: body.status,
        },
        (trx, actor) =>
          changeMemberStatus(trx, {
            accountId: ctx.params.accountId,
            actorId: actor.actorId,
            actorRole: actor.role,
            userId: ctx.params.userId,
            status: body.status as 'active' | 'disabled' | 'archived',
          })
      );
      return ctx.response.ok(result);
    } catch (error) {
      return replyMemberError(ctx, error);
    }
  }

  async enableAccess(ctx: HttpContext) {
    try {
      const result = await semanticMutation(
        ctx,
        'enable-member-access',
        { userId: ctx.params.userId },
        (trx, actor) =>
          enableMemberAccess(trx, {
            accountId: ctx.params.accountId,
            actorId: actor.actorId,
            actorRole: actor.role,
            userId: ctx.params.userId,
          })
      );
      return ctx.response.ok(result);
    } catch (error) {
      return replyMemberError(ctx, error);
    }
  }

  async remove(ctx: HttpContext) {
    try {
      await semanticMutation(ctx, 'remove-member', { userId: ctx.params.userId }, (trx, actor) =>
        removeMember(trx, {
          accountId: ctx.params.accountId,
          actorId: actor.actorId,
          actorRole: actor.role,
          userId: ctx.params.userId,
        })
      );
      return ctx.response.noContent();
    } catch (error) {
      return replyMemberError(ctx, error);
    }
  }
}
