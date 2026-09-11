import { useCallback, useState } from "react";
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

function createSubmitInvite({
  authMode,
  clear,
  requestAccountId,
  isActiveAccount,
  withMemberAction,
  fail,
  reloadInvites,
  reconcileUnknownMutation,
  invitationPreauthorizedEmail,
  inviteRole,
  setInvitationPreauthorizedEmail,
  setMintedLink,
}: InviteMutationDependencies) {
  return async () => {
    clear();
    requestAccountId();
    const emailValidation = buildInviteEmailValidation(authMode, invitationPreauthorizedEmail);
    if (emailValidation.kind === "invalid") {
      return fail("invite", emailValidation.message);
    }
    const trimmed = emailValidation.email;
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
        setMintedLink({
          inviteId: result.value.id ?? null,
          link: `${window.location.origin}/invite/${encodeURIComponent(result.value.token)}`,
        });
        setInvitationPreauthorizedEmail("");
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
  setMintedLink,
}: Pick<
  InviteMutationDependencies,
  | "withMemberAction"
  | "isActiveAccount"
  | "fail"
  | "setNotice"
  | "reloadInvites"
  | "reconcileUnknownMutation"
  | "setMintedLink"
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
        setMintedLink((current) => (current?.inviteId === id ? null : current));
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
export function useMemberInvites() {
  const [inviteRole, setInviteRole] = useState<InvitationRole>("editor");
  const [invitationPreauthorizedEmail, setInvitationPreauthorizedEmail] = useState("");
  // The freshly-minted link, shown ONCE after a successful create (the token is write-once). Keep
  // its non-secret invite id so a revoke or authoritative list refresh can clear a now-dead link.
  const [mintedLink, setMintedLink] = useState<MintedInviteLink | null>(null);
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
    });
    const revokeInvite = createRevokeInvite({
      withMemberAction,
      isActiveAccount,
      fail,
      setNotice,
      reloadInvites,
      reconcileUnknownMutation,
      setMintedLink,
    });
    const copyLink = createCopyLink({ requestAccountId, isActiveAccount, setNotice });
    return { submitInvite, revokeInvite, copyLink };
  };
  return {
    inviteRole,
    setInviteRole,
    invitationPreauthorizedEmail,
    setInvitationPreauthorizedEmail,
    mintedLink,
    reconcileMintedInvite,
    createActions,
  };
}
