import type { Dispatch, SetStateAction } from "react";
import { m } from "@/i18n";
import type { MembershipStatus } from "@capacitylens/shared/account/types";
import type { Role } from "@capacitylens/shared/domain/access";
import { resolveRejectionMessage, teamAccessClient, type TeamMember as Member } from "../../account/teamAccessClient";
import { resolveErrorMessage } from "../../lib/errorMessage";
import type { MemberActionDependencies } from "./memberActionDependencies";
import type { createMemberAccessReconciliation } from "./createMemberAccessReconciliation";
import { createMemberCredentialMutations } from "./createMemberCredentialMutations";

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

export function createMemberMutations(dependencies: MemberMutationDependencies) {
  const {
    withMemberAction,
    isActiveAccount,
    fail,
    setNotice,
    reconcileUnknownMutation,
    refreshCallerAccess,
    refreshDirectory,
    reload,
    clearResetLinkFor,
  } = dependencies;
  const changeSignInTracking = (next: boolean) =>
    withMemberAction("member-sign-in-tracking", async (accountId) => {
      try {
        const result = await teamAccessClient.setMemberSignInTracking(accountId, next);
        if (!isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          fail(
            null,
            resolveRejectionMessage(result, m.settings_members_err_sign_in_tracking({ status: result.status })),
          );
          reload();
          return;
        }
        setNotice(
          result.value ? m.settings_members_sign_in_tracking_enabled() : m.settings_members_sign_in_tracking_disabled(),
        );
        reload();
      } catch (cause) {
        fail(null, m.settings_err_server({ error: resolveErrorMessage(cause) }));
        reload();
      }
    });
  // NB: the param is `mem`, NOT `m` — `m` is the i18n catalogue, not a Member.
  const changeRole = async (member: Member, nextRole: Role) => {
    if (nextRole === member.role) return;
    await withMemberAction(`role:${member.userId}`, async (accountId) => {
      try {
        const result = await teamAccessClient.changeMemberRole(accountId, member.userId, nextRole);
        if (!isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          if (result.kind === "unknown") {
            await reconcileUnknownMutation(m.settings_members_unknown_role_change(), {
              callerAccessMayHaveChanged: member.isSelf,
            });
            return;
          }
          fail(null, resolveRejectionMessage(result, m.settings_members_err_change_role({ status: result.status })));
          return;
        }
        setNotice(m.settings_members_role_updated());
        clearResetLinkFor(member.userId);
        if (member.isSelf) await refreshCallerAccess();
        refreshDirectory();
      } catch (e) {
        await reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_role_change(),
            error: resolveErrorMessage(e),
          }),
          { callerAccessMayHaveChanged: member.isSelf },
        );
      }
    });
  };

  // NB: the param is `mem`, NOT `m` — see changeRole above (`m` is the i18n catalogue, not a Member).
  const removeMember = (member: Member) =>
    withMemberAction(`remove:${member.userId}`, async (accountId) => {
      try {
        const result = await teamAccessClient.removeMember(accountId, member.userId);
        if (!isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          if (result.kind === "unknown") {
            await reconcileUnknownMutation(m.settings_members_unknown_member_removal(), {
              callerAccessMayHaveChanged: member.isSelf,
            });
            return;
          }
          fail(null, resolveRejectionMessage(result, m.settings_members_err_remove({ status: result.status })));
          return;
        }
        setNotice(m.settings_members_removed());
        clearResetLinkFor(member.userId);
        if (member.isSelf) {
          await refreshCallerAccess(true);
        }
        refreshDirectory();
      } catch (e) {
        await reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_member_removal(),
            error: resolveErrorMessage(e),
          }),
          { callerAccessMayHaveChanged: member.isSelf },
        );
      }
    });

  // Disable / archive / restore a membership. The row survives with its role intact; every
  // authorization read narrows on status='active', so a non-active membership simply confers
  // nothing. `mem` is NOT `m` (the i18n catalogue) — see changeRole above.
  const changeStatus = async (member: Member, nextStatus: MembershipStatus) => {
    if (nextStatus === member.status) return;
    await withMemberAction(`status:${member.userId}`, async (accountId) => {
      try {
        const result = await teamAccessClient.changeMemberStatus(accountId, member.userId, nextStatus);
        if (!isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          if (result.kind === "unknown") {
            await reconcileUnknownMutation(m.settings_members_unknown_status_change());
            return;
          }
          fail(null, resolveRejectionMessage(result, m.settings_members_err_change_status({ status: result.status })));
          return;
        }
        setNotice(m.settings_members_status_changed());
        clearResetLinkFor(member.userId);
        refreshDirectory();
      } catch (e) {
        await reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_status_change(),
            error: resolveErrorMessage(e),
          }),
        );
      }
    });
  };

  return {
    changeSignInTracking,
    changeRole,
    removeMember,
    changeStatus,
    ...createMemberCredentialMutations(dependencies),
  };
}
