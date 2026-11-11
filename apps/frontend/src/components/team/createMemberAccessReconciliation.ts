import { m } from '@/i18n';
import { teamAccessClient } from '@/account/teamAccessClient';
import { resolveErrorMessage } from '@/lib/errorMessage';
import type { MemberActionDependencies } from './MemberActionDependencies';
import type { useTeamDirectory } from './useTeamDirectory';

type MemberAccessDependencies = Pick<
  MemberActionDependencies,
  'requestAccountId' | 'isActiveAccount' | 'fail' | 'setNotice'
> & {
  beginAuthorizedRead: ReturnType<typeof useTeamDirectory>['beginAuthorizedRead'];
};

async function reloadAuthorizedDirectory({
  accountId,
  message,
  isActiveAccount,
  setNotice,
  beginAuthorizedRead,
}: Pick<MemberAccessDependencies, 'isActiveAccount' | 'setNotice' | 'beginAuthorizedRead'> & {
  accountId: string;
  message: string;
}): Promise<{ kind: 'ready' } | { kind: 'stale' } | { kind: 'failed'; error: unknown }> {
  try {
    const replaceAuthorizedDirectory = beginAuthorizedRead();
    const [memberResult, inviteResult] = await Promise.all([
      teamAccessClient.listMembers(accountId),
      teamAccessClient.listInvitations(accountId),
    ]);
    if (!isActiveAccount(accountId)) return { kind: 'stale' };
    if (memberResult.kind !== 'ok' || inviteResult.kind !== 'ok') {
      return { kind: 'failed', error: new Error(m.settings_members_err_authoritative_reload()) };
    }
    replaceAuthorizedDirectory(memberResult.value, inviteResult.value);
    setNotice(m.settings_members_reconcile_directory({ message }), 'warning');
    return { kind: 'ready' };
  } catch (error) {
    // Return a typed failed reconciliation result so its owner can decide the visible recovery policy.
    return { kind: 'failed', error };
  }
}

/** Reconciles the member directory after a member change whose outcome is unknown. */
export function createMemberAccessReconciliation({
  requestAccountId,
  isActiveAccount,
  fail,
  setNotice,
  beginAuthorizedRead,
}: MemberAccessDependencies) {
  const reconcileUnknownMutation = async (message: string): Promise<void> => {
    const accountId = requestAccountId();
    if (!isActiveAccount(accountId)) return;
    const reloadResult = await reloadAuthorizedDirectory({
      accountId,
      message,
      isActiveAccount,
      setNotice,
      beginAuthorizedRead,
    });
    if (reloadResult.kind !== 'failed' || !isActiveAccount(accountId)) return;
    fail(
      null,
      m.settings_members_reconcile_reload_failed({
        message,
        error: resolveErrorMessage(reloadResult.error),
      }),
    );
  };
  return { reconcileUnknownMutation };
}
