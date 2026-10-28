import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { m } from "@/i18n";
import type { InvitationRole } from "@capacitylens/shared/account/types";
import { isAccountEmail } from "@capacitylens/shared/account/validation";
import { resolveRejectionMessage, teamAccessClient } from "@/account/teamAccessClient";
import type { TeamInvitation } from "@/account/teamAccessClient";
import type { FieldError } from "@/hooks/useFieldError";
import { resolveErrorMessage } from "@/lib/errorMessage";
import type { MemberActionDependencies } from "./MemberActionDependencies";
import type { createMemberAccessReconciliation } from "./createMemberAccessReconciliation";

interface MemberInviteDependencies extends MemberActionDependencies {
  clear: FieldError["clear"];
  reloadInvites: () => Promise<void>;
  reconcileUnknownMutation: ReturnType<typeof createMemberAccessReconciliation>["reconcileUnknownMutation"];
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
  requestAccountId,
  isActiveAccount,
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
    requestAccountId();
    const email = invitationPreauthorizedEmail.trim();
    if (!email) return fail("invite", m.settings_invite_email_required());
    if (!isAccountEmail(email)) return fail("invite", m.identity_err_email());
    await withMemberAction("invite:create", async (accountId) => {
      try {
        const result = await teamAccessClient.createInvitation({ accountId, role: inviteRole, email });
        if (!isActiveAccount(accountId)) return;
        if (result.kind === "unknown" || result.kind === "invalid") {
          await reconcileUnknownMutation(m.settings_members_unknown_invite_creation());
          return;
        }
        if (result.kind === "rejected") {
          fail("invite", result.message ?? m.settings_members_err_create_invite({ status: result.status }));
          return;
        }
        if (result.value.emailed) setNotice(m.settings_invite_emailed({ address: email }));
        else setNotice(m.settings_invite_not_emailed(), "warning");
        setInvitationPreauthorizedEmail("");
        clear();
        void reloadInvites();
      } catch (e) {
        if (!isActiveAccount(accountId)) return;
        // Invitation creation may have committed despite a lost response, so reconcile before sending another.
        await reconcileUnknownMutation(resolveInviteMutationError(m.settings_members_unknown_invite_creation(), e));
      }
    });
  };
}

type InviteActionDependencies = Pick<
  InviteMutationDependencies,
  "withMemberAction" | "isActiveAccount" | "fail" | "setNotice" | "reloadInvites" | "reconcileUnknownMutation"
>;

function createRevokeInvite({
  withMemberAction,
  isActiveAccount,
  fail,
  setNotice,
  reloadInvites,
  reconcileUnknownMutation,
}: InviteActionDependencies) {
  return (id: string) =>
    withMemberAction(`invite:revoke:${id}`, async (accountId) => {
      try {
        const result = await teamAccessClient.revokeInvitation(accountId, id);
        if (!isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          if (result.kind === "unknown") {
            await reconcileUnknownMutation(m.settings_members_unknown_invite_revocation());
            return;
          }
          fail(null, resolveRejectionMessage(result, m.settings_members_err_revoke_invite({ status: result.status })));
          return;
        }
        setNotice(m.settings_members_invite_revoked());
        void reloadInvites();
      } catch (e) {
        if (!isActiveAccount(accountId)) return;
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
  isActiveAccount,
  fail,
  setNotice,
  reloadInvites,
}: InviteActionDependencies) {
  return (invitation: TeamInvitation) =>
    withMemberAction(`invite:resend:${invitation.id}`, async (accountId) => {
      try {
        const result = await teamAccessClient.resendInvitation(accountId, invitation.id);
        if (!isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          fail(null, resolveRejectionMessage(result, m.settings_invite_resend_failed()));
          return;
        }
        if (result.value.emailed) setNotice(m.settings_invite_resent({ email: invitation.preauthEmail }));
        else setNotice(m.settings_invite_not_emailed(), "warning");
        void reloadInvites();
      } catch (e) {
        if (!isActiveAccount(accountId)) return;
        console.warn("Invitation resend failed", e);
        fail(null, resolveInviteMutationError(m.settings_invite_resend_failed(), e));
      }
    });
}

/** Holds the invitation draft and binds its actions to the member directory. */
export function useMemberInvites() {
  const [inviteRole, setInviteRole] = useState<InvitationRole>("editor");
  const [invitationPreauthorizedEmail, setInvitationPreauthorizedEmail] = useState("");
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const openInviteDialog = useCallback(() => setInviteDialogOpen(true), []);
  const closeInviteDialog = useCallback(() => setInviteDialogOpen(false), []);
  // Losing invite access hides the panel, so also close the dialog rather than reopen it later.
  const resetInviteDraft = useCallback(() => {
    setInvitationPreauthorizedEmail("");
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
