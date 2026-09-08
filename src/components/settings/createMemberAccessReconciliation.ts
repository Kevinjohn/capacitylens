import { m } from "@/i18n";
import { teamAccessClient } from "../../account/teamAccessClient";
import { refreshAccountSummaries } from "../../auth/useAccountSummaries";
import { readOfflineStateSnapshot } from "../../data/offlineCache";
import { refreshActiveAccountSlice } from "../../data/persist";
import { resolveErrorMessage } from "../../lib/errorMessage";
import type { MemberActionDependencies } from "./memberActionDependencies";
import type { useTeamDirectory } from "./useTeamDirectory";
import type { useMemberInvites } from "./useMemberInvites";

interface RefreshCallerAccessInput {
  knownRemoved?: boolean | undefined;
}

type CallerAccessRefreshResult = { kind: "active" } | { kind: "left" } | { kind: "failed" };

interface MemberAccessDependencies extends Pick<
  MemberActionDependencies,
  "requestAccountId" | "isActiveAccount" | "fail" | "setNotice"
> {
  activeAccountId: string | null;
  invalidateMemberships: () => void;
  refreshAuth: () => Promise<void>;
  closeActiveAccount: () => void;
  bumpReadiness: () => void;
  replaceAuthorizedDirectory: ReturnType<typeof useTeamDirectory>["replaceAuthorizedDirectory"];
  reconcileMintedInvite: ReturnType<typeof useMemberInvites>["reconcileMintedInvite"];
}

export function createMemberAccessReconciliation({
  activeAccountId,
  invalidateMemberships,
  refreshAuth,
  closeActiveAccount,
  requestAccountId,
  isActiveAccount,
  fail,
  setNotice,
  bumpReadiness,
  replaceAuthorizedDirectory,
  reconcileMintedInvite,
}: MemberAccessDependencies) {
  /** Re-resolve every caller-owned projection after a possible self-role mutation. The role badge
   * and affordances fail closed immediately via membershipRevision; the tenant slice is then fetched
   * again under the new server role so confidential fields from the old projection cannot linger. */
  const refreshCallerAccess = async ({
    knownRemoved = false,
  }: RefreshCallerAccessInput = {}): Promise<CallerAccessRefreshResult> => {
    const accountId = activeAccountId;
    if (!accountId) return { kind: "failed" };
    invalidateMemberships();
    await refreshAuth();
    if (!isActiveAccount(accountId)) return { kind: "left" };
    const summaries = await refreshAccountSummaries({
      allowCachedFallback: false,
    });
    if (!isActiveAccount(accountId)) return { kind: "left" };
    // A cached fallback is useful for ordinary offline viewing but is not evidence of the caller's
    // post-mutation role. Fail closed instead of accepting a stale membership list as authority.
    if (summaries === null || readOfflineStateSnapshot().readOnly) {
      closeActiveAccount();
      setNotice(m.settings_members_access_refresh_failed(), "error");
      return { kind: "failed" };
    }
    const stillMember = !knownRemoved && summaries.some((account) => account.id === accountId);
    if (!stillMember) {
      closeActiveAccount();
      return { kind: "left" };
    }
    const outcome = await refreshActiveAccountSlice(accountId);
    if (!isActiveAccount(accountId)) return { kind: "left" };
    // `refreshActiveAccountSlice` can report `reloaded` after restoring an offline snapshot. That is
    // still not an authoritative post-role projection: close the tenant so confidential fields
    // from the caller's previous role cannot remain visible under an unverified role badge.
    if (outcome.kind === "reloaded" && !readOfflineStateSnapshot().readOnly) return { kind: "active" };
    // A user-initiated tenant switch can legitimately supersede this refresh. Never close the new
    // tenant or replace its notice because a stale operation finished late.
    closeActiveAccount();
    setNotice(m.settings_members_access_refresh_failed(), "error");
    return { kind: "failed" };
  };

  const reconcileUnknownMutation = async (
    message: string,
    { callerAccessMayHaveChanged = false }: { callerAccessMayHaveChanged?: boolean } = {},
  ): Promise<void> => {
    const accountId = requestAccountId();
    if (!isActiveAccount(accountId)) return;
    const accessResult = callerAccessMayHaveChanged ? await refreshCallerAccess() : null;
    if (!isActiveAccount(accountId)) return;
    if (accessResult?.kind === "failed") return;
    if (accessResult?.kind === "left") {
      setNotice(m.settings_members_reconcile_company_access({ message }), "warning");
      return;
    }
    try {
      const [memberResult, inviteResult] = await Promise.all([
        teamAccessClient.listMembers(accountId),
        teamAccessClient.listInvitations(accountId),
      ]);
      if (!isActiveAccount(accountId)) return;
      if (memberResult.kind !== "ok" || inviteResult.kind !== "ok") {
        throw new Error(m.settings_members_err_authoritative_reload());
      }
      const nextInvites = inviteResult.value;
      replaceAuthorizedDirectory(memberResult.value, nextInvites);
      bumpReadiness();
      reconcileMintedInvite(nextInvites);
      setNotice(m.settings_members_reconcile_directory({ message }), "warning");
    } catch (reloadError) {
      if (!isActiveAccount(accountId)) return;
      if (accessResult?.kind === "active") {
        setNotice(m.settings_members_reconcile_access({ message }), "warning");
      } else {
        fail(
          null,
          m.settings_members_reconcile_reload_failed({
            message,
            error: resolveErrorMessage(reloadError),
          }),
        );
      }
    }
  };

  return { refreshCallerAccess, reconcileUnknownMutation };
}
