import { useCallback, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { m } from "@/i18n";
import type { InvitationRole } from "@capacitylens/shared/account/types";
import { isAccountEmail } from "@capacitylens/shared/account/validation";
import { resolveRejectionMessage, teamAccessClient, type TeamInvitation } from "../../account/teamAccessClient";
import type { useAuth } from "../../auth/authContext";
import type { FieldError } from "../../hooks/useFieldError";
import { resolveErrorMessage } from "../../lib/errorMessage";
import type { MemberActionDependencies } from "./memberActionDependencies";
import type { createMemberAccessReconciliation } from "./createMemberAccessReconciliation";

interface MemberInviteDependencies extends MemberActionDependencies {
  authMode: ReturnType<typeof useAuth>["authMode"];
  clear: FieldError["clear"];
  reloadInvites: () => Promise<void>;
  reconcileUnknownMutation: ReturnType<typeof createMemberAccessReconciliation>["reconcileUnknownMutation"];
}

interface MintedInviteLink {
  inviteId: string | null;
  link: string;
}

interface InviteMutationDependencies extends MemberInviteDependencies {
  invitationPreauthorizedEmail: string;
  inviteRole: InvitationRole;
  setInvitationPreauthorizedEmail: Dispatch<SetStateAction<string>>;
  setMintedLink: Dispatch<SetStateAction<MintedInviteLink | null>>;
  /** Changes whenever the link is discarded; a create that resolves after that cannot show its link. */
  readLinkGeneration: () => number;
  invitationResourceId: string;
  setInvitationResourceId: Dispatch<SetStateAction<string>>;
}

export interface InvitationPersonOption {
  id: string;
  label: string;
}

type InviteEmailValidationResult = { kind: "valid"; email: string } | { kind: "invalid"; message: string };

function buildInviteEmailValidation(
  authMode: MemberInviteDependencies["authMode"],
  email: string,
): InviteEmailValidationResult {
  const trimmed = email.trim();
  if (authMode === "sso" && trimmed.length === 0) {
    return { kind: "invalid", message: m.settings_sso_invite_email_required() };
  }
  if (trimmed.length > 0 && !isAccountEmail(trimmed)) {
    return { kind: "invalid", message: m.identity_err_email() };
  }
  return { kind: "valid", email: trimmed };
}

function resolveInviteMutationError(message: string, error: unknown) {
  return m.settings_members_error_detail({ message, error: resolveErrorMessage(error) });
}

// eslint-disable-next-line max-lines-per-function
function createSubmitInvite({
  authMode,
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
  setMintedLink,
  readLinkGeneration,
  invitationResourceId,
  setInvitationResourceId,
  invitationPeople,
}: InviteMutationDependencies & { invitationPeople: readonly InvitationPersonOption[] }) {
  return async () => {
    const linkGeneration = readLinkGeneration();
    clear();
    requestAccountId();
    const emailValidation = buildInviteEmailValidation(authMode, invitationPreauthorizedEmail);
    if (emailValidation.kind === "invalid") {
      return fail("invite", emailValidation.message);
    }
    if (invitationResourceId && !invitationPeople.some((person) => person.id === invitationResourceId)) {
      return fail("invite", m.settings_invite_person_stale());
    }
    const trimmed = emailValidation.email;
    await withMemberAction("invite:create", async (accountId) => {
      setMintedLink(null);
      try {
        const result = await teamAccessClient.createInvitation({
          accountId,
          role: inviteRole,
          ...(trimmed ? { preauthEmail: trimmed } : {}),
          ...(invitationResourceId ? { proposedResourceId: invitationResourceId } : {}),
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
        if (readLinkGeneration() === linkGeneration) {
          setMintedLink({
            inviteId: result.value.id ?? null,
            link: `${window.location.origin}/invite/${encodeURIComponent(result.value.token)}`,
          });
        } else {
          // The dialog closed first, so the write-once link can no longer be shown. Say so rather
          // than leave a live invite nobody can share.
          setNotice(m.settings_members_invite_created_link_discarded());
        }
        setInvitationPreauthorizedEmail("");
        setInvitationResourceId("");
        clear();
        void reloadInvites();
      } catch (e) {
        await reconcileUnknownMutation(resolveInviteMutationError(m.settings_members_unknown_invite_creation(), e));
      }
    });
  };
}

function createRevokeInvite({
  withMemberAction,
  isActiveAccount,
  fail,
  setNotice,
  reloadInvites,
  reconcileUnknownMutation,
}: Pick<
  InviteMutationDependencies,
  "withMemberAction" | "isActiveAccount" | "fail" | "setNotice" | "reloadInvites" | "reconcileUnknownMutation"
>) {
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
        await reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_invite_revocation(),
            error: resolveErrorMessage(e),
          }),
        );
      }
    });
}

function createCopyLink({
  requestAccountId,
  isActiveAccount,
  setNotice,
}: Pick<MemberInviteDependencies, "requestAccountId" | "isActiveAccount" | "setNotice">) {
  return (link: string, copiedNotice: string) => {
    const accountId = requestAccountId();
    const publishNotice = (message: string, tone?: "error") => {
      if (isActiveAccount(accountId)) setNotice(message, tone);
    };
    void (async () => {
      try {
        await navigator.clipboard.writeText(link);
        publishNotice(copiedNotice);
      } catch {
        publishNotice(m.settings_members_copy_failed(), "error");
      }
    })();
  };
}

/** Establish link reconciliation before directory reads, then bind actions to directory outputs. */
// eslint-disable-next-line max-lines-per-function
export function useMemberInvites() {
  const [inviteRole, setInviteRole] = useState<InvitationRole>("editor");
  const [invitationPreauthorizedEmail, setInvitationPreauthorizedEmail] = useState("");
  const [invitationResourceId, setInvitationResourceId] = useState("");
  // The freshly-minted link, shown ONCE after a successful create (the token is write-once). Keep
  // its non-secret invite id so an authoritative list refresh can clear a now-dead link.
  const [mintedLink, setMintedLink] = useState<MintedInviteLink | null>(null);
  const reconcileMintedInvite = useCallback((nextInvites: TeamInvitation[]) => {
    setMintedLink((current) =>
      current?.inviteId && !nextInvites.some((invite) => invite.id === current.inviteId && invite.usedAt === null)
        ? null
        : current,
    );
  }, []);
  // The link lives exactly as long as the dialog that shows it. Closing the dialog (or resetting the
  // draft) ends the "shown once" moment, including for a create still in flight at that point.
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const linkGeneration = useRef(0);
  const discardMintedLink = useCallback(() => {
    linkGeneration.current += 1;
    setMintedLink(null);
  }, []);
  const openInviteDialog = useCallback(() => setInviteDialogOpen(true), []);
  const closeInviteDialog = useCallback(() => {
    setInviteDialogOpen(false);
    discardMintedLink();
  }, [discardMintedLink]);
  // Losing invite access hides the panel, so also close the dialog rather than reopen it later.
  const resetInviteDraft = useCallback(() => {
    setInvitationPreauthorizedEmail("");
    setInvitationResourceId("");
    closeInviteDialog();
  }, [closeInviteDialog]);

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
    invitationPeople,
  }: MemberInviteDependencies & { invitationPeople: readonly InvitationPersonOption[] }) => {
    const submitInvite = createSubmitInvite({
      authMode,
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
      setMintedLink,
      readLinkGeneration: () => linkGeneration.current,
      invitationResourceId,
      setInvitationResourceId,
      invitationPeople,
    });
    const revokeInvite = createRevokeInvite({
      withMemberAction,
      isActiveAccount,
      fail,
      setNotice,
      reloadInvites,
      reconcileUnknownMutation,
    });
    const copyLink = createCopyLink({ requestAccountId, isActiveAccount, setNotice });
    return { submitInvite, revokeInvite, copyLink };
  };
  return {
    inviteRole,
    setInviteRole,
    invitationPreauthorizedEmail,
    setInvitationPreauthorizedEmail,
    invitationResourceId,
    setInvitationResourceId,
    mintedLink,
    inviteDialogOpen,
    openInviteDialog,
    closeInviteDialog,
    resetInviteDraft,
    reconcileMintedInvite,
    createActions,
  };
}
