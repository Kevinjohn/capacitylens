import type { Dispatch, SetStateAction } from "react";
import { m } from "@/i18n";
import type { MembershipStatus } from "@capacitylens/shared/account/types";
import type { Role } from "@capacitylens/shared/domain/access";
import { resolveRejectionMessage, teamAccessClient, type TeamMember as Member } from "../../account/teamAccessClient";
import { resolveErrorMessage } from "../../lib/errorMessage";
import type { MemberActionDependencies } from "./memberActionDependencies";
import type { createMemberAccessReconciliation } from "./createMemberAccessReconciliation";
import { createMemberCredentialMutations } from "./createMemberCredentialMutations";

interface ChangeSignInTrackingInput {
  next: boolean;
}

export interface MemberMutationDependencies extends Pick<
  MemberActionDependencies,
  "withMemberAction" | "isActiveAccount" | "fail" | "setNotice"
> {
  refreshCallerAccess: ReturnType<typeof createMemberAccessReconciliation>["refreshCallerAccess"];
  reconcileUnknownMutation: ReturnType<typeof createMemberAccessReconciliation>["reconcileUnknownMutation"];
  refreshDirectory: () => void;
  reload: () => void;
  bumpReadiness: () => void;
  clearResetLinkFor: (userId: string) => void;
  setResetLink: Dispatch<SetStateAction<{ userId: string; link: string; member: string; expiresAt: string } | null>>;
}

function createSignInTrackingMutation(dependencies: MemberMutationDependencies) {
  return ({ next }: ChangeSignInTrackingInput) =>
    dependencies.withMemberAction("member-sign-in-tracking", async (accountId) => {
      try {
        const result = await teamAccessClient.setMemberSignInTracking(accountId, next);
        if (!dependencies.isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          dependencies.fail(
            null,
            resolveRejectionMessage(result, m.settings_members_err_sign_in_tracking({ status: result.status })),
          );
          dependencies.reload();
          return;
        }
        dependencies.setNotice(
          result.value ? m.settings_members_sign_in_tracking_enabled() : m.settings_members_sign_in_tracking_disabled(),
        );
        dependencies.reload();
      } catch (cause) {
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
        if (result.kind !== "ok") {
          if (result.kind === "unknown") {
            await dependencies.reconcileUnknownMutation(m.settings_members_unknown_role_change(), {
              callerAccessMayHaveChanged: member.isSelf,
            });
            return;
          }
          dependencies.fail(
            null,
            resolveRejectionMessage(result, m.settings_members_err_change_role({ status: result.status })),
          );
          return;
        }
        dependencies.setNotice(m.settings_members_role_updated());
        dependencies.clearResetLinkFor(member.userId);
        if (member.isSelf) await dependencies.refreshCallerAccess();
        dependencies.refreshDirectory();
      } catch (cause) {
        await dependencies.reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_role_change(),
            error: resolveErrorMessage(cause),
          }),
          { callerAccessMayHaveChanged: member.isSelf },
        );
      }
    });
  };
}

function createRemoveMemberMutation(dependencies: MemberMutationDependencies) {
  return (member: Member) =>
    dependencies.withMemberAction(`remove:${member.userId}`, async (accountId) => {
      try {
        const result = await teamAccessClient.removeMember(accountId, member.userId);
        if (!dependencies.isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          if (result.kind === "unknown") {
            await dependencies.reconcileUnknownMutation(m.settings_members_unknown_member_removal(), {
              callerAccessMayHaveChanged: member.isSelf,
            });
            return;
          }
          dependencies.fail(
            null,
            resolveRejectionMessage(result, m.settings_members_err_remove({ status: result.status })),
          );
          return;
        }
        dependencies.setNotice(m.settings_members_removed());
        dependencies.clearResetLinkFor(member.userId);
        if (member.isSelf) {
          await dependencies.refreshCallerAccess({ knownRemoved: true });
        }
        dependencies.refreshDirectory();
      } catch (cause) {
        await dependencies.reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_member_removal(),
            error: resolveErrorMessage(cause),
          }),
          { callerAccessMayHaveChanged: member.isSelf },
        );
      }
    });
}

function createStatusMutation(dependencies: MemberMutationDependencies) {
  return async (member: Member, nextStatus: MembershipStatus) => {
    if (nextStatus === member.status) return;
    await dependencies.withMemberAction(`status:${member.userId}`, async (accountId) => {
      try {
        const result = await teamAccessClient.changeMemberStatus(accountId, member.userId, nextStatus);
        if (!dependencies.isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          if (result.kind === "unknown") {
            await dependencies.reconcileUnknownMutation(m.settings_members_unknown_status_change());
            return;
          }
          dependencies.fail(
            null,
            resolveRejectionMessage(result, m.settings_members_err_change_status({ status: result.status })),
          );
          return;
        }
        dependencies.setNotice(m.settings_members_status_changed());
        dependencies.clearResetLinkFor(member.userId);
        dependencies.refreshDirectory();
      } catch (cause) {
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

export function createMemberMutations(dependencies: MemberMutationDependencies) {
  return {
    changeSignInTracking: createSignInTrackingMutation(dependencies),
    changeRole: createRoleMutation(dependencies),
    removeMember: createRemoveMemberMutation(dependencies),
    changeStatus: createStatusMutation(dependencies),
    ...createMemberCredentialMutations(dependencies),
  };
}
