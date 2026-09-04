import { useCallback, useState } from "react";
import { m } from "@/i18n";
import type { InvitationRole } from "@capacitylens/shared/account/types";
import { isAccountEmail } from "@capacitylens/shared/account/validation";
import { rejectionMessage, teamAccessClient, type TeamInvitation } from "../../account/teamAccessClient";
import type { useAuth } from "../../auth/authContext";
import type { FieldError } from "../../hooks/useFieldError";
import { errorMessage } from "../../lib/errorMessage";
import type { MemberActionDependencies } from "./memberActionDependencies";
import type { memberAccessReconciliation } from "./memberAccessReconciliation";

interface MemberInviteDependencies extends MemberActionDependencies {
  authMode: ReturnType<typeof useAuth>["authMode"];
  clear: FieldError["clear"];
  reloadInvites: () => Promise<void>;
  reconcileUnknownMutation: ReturnType<typeof memberAccessReconciliation>["reconcileUnknownMutation"];
}

/** Establish link reconciliation before directory reads, then bind actions to directory outputs. */
export function useMemberInvites() {
  const [inviteRole, setInviteRole] = useState<InvitationRole>("editor");
  const [invitePreauth, setInvitePreauth] = useState("");
  // The freshly-minted link, shown ONCE after a successful create (the token is write-once). Keep
  // its non-secret invite id so a revoke or authoritative list refresh can clear a now-dead link.
  const [mintedLink, setMintedLink] = useState<{
    inviteId: string | null;
    link: string;
  } | null>(null);
  const reconcileMintedInvite = useCallback((nextInvites: TeamInvitation[]) => {
    setMintedLink((current) =>
      current?.inviteId && !nextInvites.some((invite) => invite.id === current.inviteId && invite.usedAt === null)
        ? null
        : current,
    );
  }, []);

  const createActions = ({
    authMode,
    clear,
    requestAccountId,
    isActiveAccount,
    withMemberAction,
    fail,
    setNotice,
    reloadInvites,
    reconcileUnknownMutation,
  }: MemberInviteDependencies) => {
    const submitInvite = async () => {
      clear();
      // Ordering, preserved from the inline sequence this envelope replaced: an absent active account
      // is raised BEFORE the draft is validated — with no company open there is nothing to invite
      // anyone to, whatever the form says.
      requestAccountId();
      const trimmed = invitePreauth.trim();
      if (authMode === "sso" && trimmed.length === 0) {
        fail("invite", m.settings_sso_invite_email_required());
        return;
      }
      if (trimmed.length > 0 && !isAccountEmail(trimmed)) {
        fail("invite", m.identity_err_email());
        return;
      }
      await withMemberAction("invite:create", async (accountId) => {
        setMintedLink(null);
        try {
          const result = await teamAccessClient.createInvitation({
            accountId,
            role: inviteRole,
            ...(trimmed ? { preauthEmail: trimmed } : {}),
          });
          if (!isActiveAccount(accountId)) return;
          if (result.kind !== "ok") {
            if (result.kind === "unknown") {
              await reconcileUnknownMutation(m.settings_members_unknown_invite_creation());
              return;
            }
            if (result.kind === "invalid") {
              const message = m.settings_members_unknown_invite_value_lost();
              await reconcileUnknownMutation(message);
              fail(null, message);
              return;
            }
            fail("invite", result.message ?? m.settings_members_err_create_invite({ status: result.status }));
            return;
          }
          const body = result.value;
          // The token is write-once: build + show the link straight from this response and never again.
          setMintedLink({
            inviteId: body.id ?? null,
            link: `${window.location.origin}/invite/${encodeURIComponent(body.token)}`,
          });
          setInvitePreauth("");
          clear();
          setNotice(m.settings_members_invite_created());
          // Invites only: creating one cannot have changed the member list, and re-reading it would
          // re-ask an authorization question this write did not answer.
          void reloadInvites();
        } catch (e) {
          await reconcileUnknownMutation(
            m.settings_members_error_detail({
              message: m.settings_members_unknown_invite_creation(),
              error: errorMessage(e),
            }),
          );
        }
      });
    };

    const revokeInvite = (id: string) =>
      withMemberAction(`invite:revoke:${id}`, async (accountId) => {
        try {
          const result = await teamAccessClient.revokeInvitation(accountId, id);
          if (!isActiveAccount(accountId)) return;
          if (result.kind !== "ok") {
            if (result.kind === "unknown") {
              await reconcileUnknownMutation(m.settings_members_unknown_invite_revocation());
              return;
            }
            fail(null, rejectionMessage(result, m.settings_members_err_revoke_invite({ status: result.status })));
            return;
          }
          setNotice(m.settings_members_invite_revoked());
          setMintedLink((current) => (current?.inviteId === id ? null : current));
          void reloadInvites(); // Invites only — see submitInvite.
        } catch (e) {
          await reconcileUnknownMutation(
            m.settings_members_error_detail({
              message: m.settings_members_unknown_invite_revocation(),
              error: errorMessage(e),
            }),
          );
        }
      });

    const copyLink = (link: string, copiedNotice: string) => {
      const accountId = requestAccountId();
      const publishNotice = (message: string, tone?: "error") => {
        if (isActiveAccount(accountId)) setNotice(message, tone);
      };
      // navigator.clipboard is undefined in insecure contexts (plain-HTTP self-hosts, some
      // WebViews). An optional chain there would short-circuit past BOTH .then callbacks —
      // a click that silently does nothing (the swallow DEFENSIVE-CODING.md forbids). Surface
      // the same failure notice instead; its wording already tells the user the manual fallback.
      if (!navigator.clipboard) {
        publishNotice(m.settings_members_copy_failed(), "error");
        return;
      }
      void navigator.clipboard.writeText(link).then(
        () => publishNotice(copiedNotice),
        () => publishNotice(m.settings_members_copy_failed(), "error"),
      );
    };

    return { submitInvite, revokeInvite, copyLink };
  };
  return {
    inviteRole,
    setInviteRole,
    invitePreauth,
    setInvitePreauth,
    mintedLink,
    reconcileMintedInvite,
    createActions,
  };
}
