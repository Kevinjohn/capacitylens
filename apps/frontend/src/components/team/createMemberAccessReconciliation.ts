import { m } from '@/i18n';
import { teamAccessClient } from '@/account/teamAccessClient';
import { resolveErrorMessage } from '@/lib/errorMessage';
import type { MemberActionDependencies } from './MemberActionDependencies';
import type { useTeamDirectory } from './useTeamDirectory';

type MemberAccessDependencies = Pick<
  MemberActionDependencies,
  'requestAccountId' | 'isActiveCompany' | 'fail' | 'setNotice'
> & {
  replaceAuthorizedDirectory: ReturnType<typeof useTeamDirectory>['replaceAuthorizedDirectory'];
};

async function reloadAuthorizedDirectory({
  companyId,
  message,
  isActiveCompany,
  setNotice,
  replaceAuthorizedDirectory,
}: Pick<
  MemberAccessDependencies,
  'isActiveCompany' | 'setNotice' | 'replaceAuthorizedDirectory'
> & {
  companyId: string;
  message: string;
}): Promise<{ kind: 'ready' } | { kind: 'stale' } | { kind: 'failed'; error: unknown }> {
  try {
    const [memberResult, inviteResult] = await Promise.all([
      teamAccessClient.listMembers(companyId),
      teamAccessClient.listInvitations(companyId),
    ]);
    if (!isActiveCompany(companyId)) return { kind: 'stale' };
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
  isActiveCompany,
  fail,
  setNotice,
  replaceAuthorizedDirectory,
}: MemberAccessDependencies) {
  const reconcileUnknownMutation = async (message: string): Promise<void> => {
    const companyId = requestAccountId();
    if (!isActiveCompany(companyId)) return;
    const reloadResult = await reloadAuthorizedDirectory({
      companyId,
      message,
      isActiveCompany,
      setNotice,
      replaceAuthorizedDirectory,
    });
    if (reloadResult.kind !== 'failed' || !isActiveCompany(companyId)) return;
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
