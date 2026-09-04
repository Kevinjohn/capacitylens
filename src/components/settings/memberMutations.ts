import type { Dispatch, SetStateAction } from "react";
import { m } from "@/i18n";
import type { MembershipStatus } from "@capacitylens/shared/account/types";
import type { Role } from "@capacitylens/shared/domain/access";
import { rejectionMessage, teamAccessClient, type TeamMember as Member } from "../../account/teamAccessClient";
import { errorMessage } from "../../lib/errorMessage";
import type { MemberActionDependencies } from "./memberActionDependencies";
import type { memberAccessReconciliation } from "./memberAccessReconciliation";
import { memberCredentialMutations } from "./memberCredentialMutations";

export interface MemberMutationDependencies extends Pick<
  MemberActionDependencies,
  "withMemberAction" | "isActiveAccount" | "fail" | "setNotice"
> {
  refreshCallerAccess: ReturnType<typeof memberAccessReconciliation>["refreshCallerAccess"];
  reconcileUnknownMutation: ReturnType<typeof memberAccessReconciliation>["reconcileUnknownMutation"];
  refreshDirectory: () => void;
  reload: () => void;
  bumpReadiness: () => void;
  clearResetLinkFor: (userId: string) => void;
  setResetLink: Dispatch<SetStateAction<{ userId: string; link: string; member: string; expiresAt: string } | null>>;
}

export function memberMutations(deps: MemberMutationDependencies) {
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
  } = deps;
  const changeSignInTracking = (next: boolean) =>
    withMemberAction("member-sign-in-tracking", async (accountId) => {
      try {
        const result = await teamAccessClient.setMemberSignInTracking(accountId, next);
        if (!isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          fail(null, rejectionMessage(result, m.settings_members_err_sign_in_tracking({ status: result.status })));
          reload();
          return;
        }
        setNotice(
          result.value ? m.settings_members_sign_in_tracking_enabled() : m.settings_members_sign_in_tracking_disabled(),
        );
        reload();
      } catch (cause) {
        fail(null, m.settings_err_server({ error: errorMessage(cause) }));
        reload();
      }
    });
  // NB: the param is `mem`, NOT `m` — `m` is the i18n catalogue, not a Member.
  const changeRole = async (mem: Member, nextRole: Role) => {
    if (nextRole === mem.role) return;
    await withMemberAction(`role:${mem.userId}`, async (accountId) => {
      try {
        const result = await teamAccessClient.changeMemberRole(accountId, mem.userId, nextRole);
        if (!isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          if (result.kind === "unknown") {
            await reconcileUnknownMutation(m.settings_members_unknown_role_change(), {
              callerAccessMayHaveChanged: mem.isSelf,
            });
            return;
          }
          fail(null, rejectionMessage(result, m.settings_members_err_change_role({ status: result.status })));
          return;
        }
        setNotice(m.settings_members_role_updated());
        clearResetLinkFor(mem.userId);
        if (mem.isSelf) await refreshCallerAccess();
        refreshDirectory();
      } catch (e) {
        await reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_role_change(),
            error: errorMessage(e),
          }),
          { callerAccessMayHaveChanged: mem.isSelf },
        );
      }
    });
  };

  // NB: the param is `mem`, NOT `m` — see changeRole above (`m` is the i18n catalogue, not a Member).
  const removeMember = (mem: Member) =>
    withMemberAction(`remove:${mem.userId}`, async (accountId) => {
      try {
        const result = await teamAccessClient.removeMember(accountId, mem.userId);
        if (!isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          if (result.kind === "unknown") {
            await reconcileUnknownMutation(m.settings_members_unknown_member_removal(), {
              callerAccessMayHaveChanged: mem.isSelf,
            });
            return;
          }
          fail(null, rejectionMessage(result, m.settings_members_err_remove({ status: result.status })));
          return;
        }
        setNotice(m.settings_members_removed());
        clearResetLinkFor(mem.userId);
        if (mem.isSelf) {
          await refreshCallerAccess(true);
        }
        refreshDirectory();
      } catch (e) {
        await reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_member_removal(),
            error: errorMessage(e),
          }),
          { callerAccessMayHaveChanged: mem.isSelf },
        );
      }
    });

  // Disable / archive / restore a membership. The row survives with its role intact; every
  // authorization read narrows on status='active', so a non-active membership simply confers
  // nothing. `mem` is NOT `m` (the i18n catalogue) — see changeRole above.
  const changeStatus = async (mem: Member, nextStatus: MembershipStatus) => {
    if (nextStatus === mem.status) return;
    await withMemberAction(`status:${mem.userId}`, async (accountId) => {
      try {
        const result = await teamAccessClient.changeMemberStatus(accountId, mem.userId, nextStatus);
        if (!isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          if (result.kind === "unknown") {
            await reconcileUnknownMutation(m.settings_members_unknown_status_change());
            return;
          }
          fail(null, rejectionMessage(result, m.settings_members_err_change_status({ status: result.status })));
          return;
        }
        setNotice(m.settings_members_status_changed());
        clearResetLinkFor(mem.userId);
        refreshDirectory();
      } catch (e) {
        await reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_status_change(),
            error: errorMessage(e),
          }),
        );
      }
    });
  };

  return { changeSignInTracking, changeRole, removeMember, changeStatus, ...memberCredentialMutations(deps) };
}
