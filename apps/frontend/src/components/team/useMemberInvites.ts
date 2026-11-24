import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { m } from '@/i18n';
import type { InvitationRole } from '@capacitylens/shared/account/types';
import { isAccountEmail } from '@capacitylens/shared/account/validation';
import { resolveRefusalMessage, teamAccessApi } from '@/account/teamAccessApi';
import type { TeamInvitation } from '@/account/teamAccessApi';
import type { FieldError } from '@/hooks/useFieldError';
import { resolveErrorMessage } from '@/lib/errorMessage';
import type { MemberOperationDependencies } from './MemberOperationDependencies';
import type { createMemberAccessReconciliation } from './createMemberAccessReconciliation';

interface MemberInviteDependencies extends MemberOperationDependencies {
  clear: FieldError['clear'];
  reloadInvites: () => Promise<void>;
  reconcileUnknownMutation: ReturnType<
    typeof createMemberAccessReconciliation
  >['reconcileUnknownMutation'];
}

interface InviteMutationDependencies extends MemberInviteDependencies {
  invitationPreauthorizedEmail: string;
  inviteRole: InvitationRole;
  setInvitationPreauthorizedEmail: Dispatch<SetStateAction<string>>;
}

function resolveInviteMutationError(message: string, error: unknown) {
  return m.settings_members_error_detail({ message, error: resolveErrorMessage(error) });
}

function createSubmitInvite({
  clear,
  requestCompanyId,
  isActiveCompany,
  withMemberAction,
  fail,
  setNotice,
  reloadInvites,
  reconcileUnknownMutation,
  invitationPreauthorizedEmail,
  inviteRole,
  setInvitationPreauthorizedEmail,
}: InviteMutationDependencies) {
  return async () => {
    clear();
    requestCompanyId();
    const email = invitationPreauthorizedEmail.trim();
    if (!email) return fail('invite', m.settings_invite_email_required());
    if (!isAccountEmail(email)) return fail('invite', m.identity_err_email());
    await withMemberAction('invite:create', async (companyId) => {
      try {
        const result = await teamAccessApi.createInvitation({
          companyId,
          role: inviteRole,
          email,
        });
        if (!isActiveCompany(companyId)) return;
        if (result.kind === 'alreadyInvited') {
          fail('invite', m.settings_invite_already_pending({ address: email }));
          void reloadInvites();
          return;
        }
        if (result.kind === 'unknown' || result.kind === 'invalid') {
          await reconcileUnknownMutation(m.settings_members_unknown_invite_creation());
          return;
        }
        if (result.kind === 'rejected') {
          fail(
            'invite',
            result.message ?? m.settings_members_err_create_invite({ status: result.status }),
          );
          return;
        }
        if (result.value.emailed) setNotice(m.settings_invite_emailed({ address: email }));
        else setNotice(m.settings_invite_not_emailed(), 'warning');
        setInvitationPreauthorizedEmail('');
        clear();
        void reloadInvites();
      } catch (e) {
        if (!isActiveCompany(companyId)) return;
        // Invitation creation may have committed despite a lost response, so reconcile before sending another.
        await reconcileUnknownMutation(
          resolveInviteMutationError(m.settings_members_unknown_invite_creation(), e),
        );
      }
    });
  };
}

type InviteActionDependencies = Pick<
  InviteMutationDependencies,
  | 'withMemberAction'
  | 'isActiveCompany'
  | 'fail'
  | 'setNotice'
  | 'reloadInvites'
  | 'reconcileUnknownMutation'
>;

function createRevokeInvite({
  withMemberAction,
  isActiveCompany,
  fail,
  setNotice,
  reloadInvites,
  reconcileUnknownMutation,
}: InviteActionDependencies) {
  return (id: string) =>
    withMemberAction(`invite:revoke:${id}`, async (companyId) => {
      try {
        const result = await teamAccessApi.revokeInvitation(companyId, id);
        if (!isActiveCompany(companyId)) return;
        if (result.kind !== 'ok') {
          if (result.kind === 'unknown') {
            await reconcileUnknownMutation(m.settings_members_unknown_invite_revocation());
            return;
          }
          fail(
            null,
            resolveRefusalMessage(
              result,
              m.settings_members_err_revoke_invite({ status: result.status }),
            ),
          );
          return;
        }
        setNotice(m.settings_members_invite_revoked());
        void reloadInvites();
      } catch (e) {
        if (!isActiveCompany(companyId)) return;
        // A lost revocation response does not prove the invitation is still live; reconcile before retrying.
        await reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_invite_revocation(),
            error: resolveErrorMessage(e),
          }),
        );
      }
    });
}

function createResendInvite({
  withMemberAction,
  isActiveCompany,
  fail,
  setNotice,
  reloadInvites,
}: InviteActionDependencies) {
  return (invitation: TeamInvitation) =>
    withMemberAction(`invite:resend:${invitation.id}`, async (companyId) => {
      try {
        const result = await teamAccessApi.resendInvitation(companyId, invitation.id);
        if (!isActiveCompany(companyId)) return;
        if (result.kind !== 'ok') {
          fail(null, resolveRefusalMessage(result, m.settings_invite_resend_failed()));
          return;
        }
        if (result.value.emailed) {
          setNotice(m.settings_invite_resent({ email: invitation.preauthEmail }));
        } else setNotice(m.settings_invite_not_emailed(), 'warning');
        void reloadInvites();
      } catch (e) {
        if (!isActiveCompany(companyId)) return;
        console.warn('Invitation resend failed', e);
        fail(null, resolveInviteMutationError(m.settings_invite_resend_failed(), e));
      }
    });
}

/** Holds the invitation draft and binds its actions to the member directory. */
export function useMemberInvites() {
  const [inviteRole, setInviteRole] = useState<InvitationRole>('editor');
  const [invitationPreauthorizedEmail, setInvitationPreauthorizedEmail] = useState('');
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const openInviteDialog = useCallback(() => setInviteDialogOpen(true), []);
  const closeInviteDialog = useCallback(() => setInviteDialogOpen(false), []);
  // Losing invite access hides the panel, so also close the dialog rather than reopen it later.
  const resetInviteDraft = useCallback(() => {
    setInvitationPreauthorizedEmail('');
    closeInviteDialog();
  }, [closeInviteDialog]);

  const createActions = (dependencies: MemberInviteDependencies) => ({
    submitInvite: createSubmitInvite({
      ...dependencies,
      invitationPreauthorizedEmail,
      inviteRole,
      setInvitationPreauthorizedEmail,
    }),
    revokeInvite: createRevokeInvite(dependencies),
    resendInvite: createResendInvite(dependencies),
  });
  return {
    inviteRole,
    setInviteRole,
    invitationPreauthorizedEmail,
    setInvitationPreauthorizedEmail,
    inviteDialogOpen,
    openInviteDialog,
    closeInviteDialog,
    resetInviteDraft,
    createActions,
  };
}
