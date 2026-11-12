import { m } from '@/i18n';
import type { MembershipStatus } from '@capacitylens/shared/account/types';
import type { Role } from '@capacitylens/shared/domain/access';
import { resolveRejectionMessage, teamAccessClient } from '@/account/teamAccessClient';
import type { TeamMember as Member } from '@/account/teamAccessClient';
import { resolveErrorMessage } from '@/lib/errorMessage';
import type { MemberActionDependencies } from './MemberActionDependencies';
import type { createMemberAccessReconciliation } from './createMemberAccessReconciliation';

interface ChangeSignInTrackingInput {
  next: boolean;
}

/** Authorized request and refresh callbacks needed for member changes. */
export interface MemberMutationDependencies extends Pick<
  MemberActionDependencies,
  'withMemberAction' | 'isActiveAccount' | 'fail' | 'setNotice'
> {
  reconcileUnknownMutation: ReturnType<
    typeof createMemberAccessReconciliation
  >['reconcileUnknownMutation'];
  refreshDirectory: () => void;
  reload: () => void;
}

function createSignInTrackingMutation(dependencies: MemberMutationDependencies) {
  return ({ next }: ChangeSignInTrackingInput) =>
    dependencies.withMemberAction('member-sign-in-tracking', async (accountId) => {
      try {
        const result = await teamAccessClient.setMemberSignInTracking({
          companyId: accountId,
          enabled: next,
        });
        if (!dependencies.isActiveAccount(accountId)) return;
        if (result.kind !== 'ok') {
          dependencies.fail(
            null,
            resolveRejectionMessage(
              result,
              m.settings_members_err_sign_in_tracking({ status: result.status }),
            ),
          );
          dependencies.reload();
          return;
        }
        dependencies.setNotice(
          result.value
            ? m.settings_members_sign_in_tracking_enabled()
            : m.settings_members_sign_in_tracking_disabled(),
        );
        dependencies.reload();
      } catch (cause) {
        // Report the member mutation failure and refresh authoritative directory state.
        dependencies.fail(null, m.settings_err_server({ error: resolveErrorMessage(cause) }));
        dependencies.reload();
      }
    });
}

function createRoleMutation(dependencies: MemberMutationDependencies) {
  return async (member: Member, nextRole: Role) => {
    if (nextRole === member.role) return;
    await dependencies.withMemberAction(`role:${member.userId}`, async (accountId) => {
      try {
        const result = await teamAccessClient.changeMemberRole(accountId, member.userId, nextRole);
        if (!dependencies.isActiveAccount(accountId)) return;
        if (result.kind !== 'ok') {
          if (result.kind === 'unknown') {
            await dependencies.reconcileUnknownMutation(m.settings_members_unknown_role_change());
            return;
          }
          dependencies.fail(
            null,
            resolveRejectionMessage(
              result,
              m.settings_members_err_change_role({ status: result.status }),
            ),
          );
          return;
        }
        dependencies.setNotice(m.settings_members_role_updated());
        dependencies.refreshDirectory();
      } catch (cause) {
        // A role-change request may have committed; reload the directory before another attempt.
        await dependencies.reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_role_change(),
            error: resolveErrorMessage(cause),
          }),
        );
      }
    });
  };
}

function createStatusMutation(dependencies: MemberMutationDependencies) {
  return async (member: Member, nextStatus: MembershipStatus) => {
    if (nextStatus === member.status) return;
    await dependencies.withMemberAction(`status:${member.userId}`, async (accountId) => {
      try {
        const result = await teamAccessClient.changeMemberStatus(
          accountId,
          member.userId,
          nextStatus,
        );
        if (!dependencies.isActiveAccount(accountId)) return;
        if (result.kind !== 'ok') {
          if (result.kind === 'unknown') {
            await dependencies.reconcileUnknownMutation(m.settings_members_unknown_status_change());
            return;
          }
          dependencies.fail(
            null,
            resolveRejectionMessage(
              result,
              m.settings_members_err_change_status({ status: result.status }),
            ),
          );
          return;
        }
        dependencies.setNotice(m.settings_members_status_changed());
        dependencies.refreshDirectory();
      } catch (cause) {
        // An uncertain membership-status change requires authoritative reconciliation before another action.
        await dependencies.reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_status_change(),
            error: resolveErrorMessage(cause),
          }),
        );
      }
    });
  };
}

/** Builds role, invitation, and lifecycle actions for team members. */
export function createMemberMutations(dependencies: MemberMutationDependencies) {
  return {
    changeSignInTracking: createSignInTrackingMutation(dependencies),
    changeRole: createRoleMutation(dependencies),
    changeStatus: createStatusMutation(dependencies),
  };
}
