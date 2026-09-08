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

function hasAuthoritativeAccountSummary(
  summaries: Awaited<ReturnType<typeof refreshAccountSummaries>>,
  accountId: string,
  knownRemoved: boolean,
) {
  return summaries !== null && !knownRemoved && summaries.some((account) => account.id === accountId);
}

function isCallerAccessUnverified(
  summaries: Awaited<ReturnType<typeof refreshAccountSummaries>>,
  offlineReadOnly: boolean,
) {
  return summaries === null || offlineReadOnly;
}

function createRefreshCallerAccess({
  activeAccountId,
  invalidateMemberships,
  refreshAuth,
  closeActiveAccount,
  isActiveAccount,
  setNotice,
}: Pick<
  MemberAccessDependencies,
  "activeAccountId" | "invalidateMemberships" | "refreshAuth" | "closeActiveAccount" | "isActiveAccount" | "setNotice"
>) {
  return async ({ knownRemoved = false }: RefreshCallerAccessInput = {}): Promise<CallerAccessRefreshResult> => {
    const accountId = activeAccountId;
    if (!accountId) return { kind: "failed" };
    invalidateMemberships();
    await refreshAuth();
    if (!isActiveAccount(accountId)) return { kind: "left" };
    const summaries = await refreshAccountSummaries({ allowCachedFallback: false });
    if (!isActiveAccount(accountId)) return { kind: "left" };
    if (isCallerAccessUnverified(summaries, readOfflineStateSnapshot().readOnly)) {
      closeActiveAccount();
      setNotice(m.settings_members_access_refresh_failed(), "error");
      return { kind: "failed" };
    }
    if (!hasAuthoritativeAccountSummary(summaries, accountId, knownRemoved)) {
      closeActiveAccount();
      return { kind: "left" };
    }
    const outcome = await refreshActiveAccountSlice(accountId);
    if (!isActiveAccount(accountId)) return { kind: "left" };
    if (outcome.kind === "reloaded" && !readOfflineStateSnapshot().readOnly) return { kind: "active" };
    closeActiveAccount();
    setNotice(m.settings_members_access_refresh_failed(), "error");
    return { kind: "failed" };
  };
}

async function reloadAuthorizedDirectory({
  accountId,
  message,
  isActiveAccount,
  setNotice,
  bumpReadiness,
  replaceAuthorizedDirectory,
  reconcileMintedInvite,
}: Pick<
  MemberAccessDependencies,
  "isActiveAccount" | "setNotice" | "bumpReadiness" | "replaceAuthorizedDirectory" | "reconcileMintedInvite"
> & {
  accountId: string;
  message: string;
}): Promise<{ kind: "ready" } | { kind: "stale" } | { kind: "failed"; error: unknown }> {
  try {
    const [memberResult, inviteResult] = await Promise.all([
      teamAccessClient.listMembers(accountId),
      teamAccessClient.listInvitations(accountId),
    ]);
    if (!isActiveAccount(accountId)) return { kind: "stale" };
    if (memberResult.kind !== "ok" || inviteResult.kind !== "ok") {
      return { kind: "failed", error: new Error(m.settings_members_err_authoritative_reload()) };
    }
    replaceAuthorizedDirectory(memberResult.value, inviteResult.value);
    bumpReadiness();
    reconcileMintedInvite(inviteResult.value);
    setNotice(m.settings_members_reconcile_directory({ message }), "warning");
    return { kind: "ready" };
  } catch (error) {
    return { kind: "failed", error };
  }
}

async function resolveCallerAccess(
  callerAccessMayHaveChanged: boolean,
  refreshCallerAccess: ReturnType<typeof createRefreshCallerAccess>,
) {
  if (!callerAccessMayHaveChanged) return null;
  return refreshCallerAccess();
}

function shouldStopReconciliation(accountIsActive: boolean, accessResult: CallerAccessRefreshResult | null) {
  return !accountIsActive || accessResult?.kind === "failed";
}

function createReconcileUnknownMutation({
  requestAccountId,
  isActiveAccount,
  fail,
  setNotice,
  bumpReadiness,
  replaceAuthorizedDirectory,
  reconcileMintedInvite,
  refreshCallerAccess,
}: Pick<
  MemberAccessDependencies,
  | "requestAccountId"
  | "isActiveAccount"
  | "fail"
  | "setNotice"
  | "bumpReadiness"
  | "replaceAuthorizedDirectory"
  | "reconcileMintedInvite"
> & {
  refreshCallerAccess: ReturnType<typeof createRefreshCallerAccess>;
}) {
  return async (
    message: string,
    { callerAccessMayHaveChanged = false }: { callerAccessMayHaveChanged?: boolean } = {},
  ): Promise<void> => {
    const accountId = requestAccountId();
    if (!isActiveAccount(accountId)) return;
    const accessResult = await resolveCallerAccess(callerAccessMayHaveChanged, refreshCallerAccess);
    if (shouldStopReconciliation(isActiveAccount(accountId), accessResult)) return;
    if (accessResult?.kind === "left") {
      setNotice(m.settings_members_reconcile_company_access({ message }), "warning");
      return;
    }
    const reloadResult = await reloadAuthorizedDirectory({
      accountId,
      message,
      isActiveAccount,
      setNotice,
      bumpReadiness,
      replaceAuthorizedDirectory,
      reconcileMintedInvite,
    });
    if (reloadResult.kind !== "failed" || !isActiveAccount(accountId)) return;
    if (accessResult?.kind === "active") {
      setNotice(m.settings_members_reconcile_access({ message }), "warning");
      return;
    }
    fail(
      null,
      m.settings_members_reconcile_reload_failed({
        message,
        error: resolveErrorMessage(reloadResult.error),
      }),
    );
  };
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
  const refreshCallerAccess = createRefreshCallerAccess({
    activeAccountId,
    invalidateMemberships,
    refreshAuth,
    closeActiveAccount,
    isActiveAccount,
    setNotice,
  });
  const reconcileUnknownMutation = createReconcileUnknownMutation({
    requestAccountId,
    isActiveAccount,
    fail,
    setNotice,
    bumpReadiness,
    replaceAuthorizedDirectory,
    reconcileMintedInvite,
    refreshCallerAccess,
  });

  return { refreshCallerAccess, reconcileUnknownMutation };
}
