import { m } from "@/i18n";
import { resolveRejectionMessage, teamAccessClient, type TeamMember as Member } from "../../account/teamAccessClient";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { resolveMemberLabel } from "./memberConfirmationCopy";
import type { MemberMutationDependencies } from "./createMemberMutations";

type ResetPasswordDependencies = Pick<
  MemberMutationDependencies,
  | "withMemberAction"
  | "isActiveAccount"
  | "fail"
  | "setNotice"
  | "reconcileUnknownMutation"
  | "setResetLink"
  | "bumpReadiness"
>;

type RevokeSessionsDependencies = Pick<
  MemberMutationDependencies,
  "withMemberAction" | "isActiveAccount" | "fail" | "setNotice" | "reconcileUnknownMutation"
>;

function createResetPassword({
  withMemberAction,
  isActiveAccount,
  fail,
  setNotice,
  reconcileUnknownMutation,
  setResetLink,
  bumpReadiness,
}: ResetPasswordDependencies) {
  return (member: Member) =>
    withMemberAction(`reset:${member.userId}`, async (accountId) => {
      setResetLink(null);
      try {
        const result = await teamAccessClient.issuePasswordReset(accountId, member.userId);
        if (!isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          if (result.kind === "unknown") {
            await reconcileUnknownMutation(m.settings_members_unknown_reset_request());
            return;
          }
          if (result.kind === "invalid") {
            await reconcileUnknownMutation(m.settings_members_unknown_reset_value_lost());
            return;
          }
          fail(null, result.message ?? m.settings_members_err_reset({ status: result.status }));
          return;
        }
        const body = result.value;
        if (!body.expiresAt) {
          await reconcileUnknownMutation(m.settings_members_unknown_reset_value_lost());
          return;
        }
        setResetLink({
          userId: member.userId,
          link: `${window.location.origin}/reset-password/${encodeURIComponent(body.token)}`,
          member: resolveMemberLabel(member),
          expiresAt: body.expiresAt,
        });
        setNotice(m.settings_members_reset_created());
        bumpReadiness();
      } catch (e) {
        await reconcileUnknownMutation(
          m.settings_members_unknown_reset_request_failed({ error: resolveErrorMessage(e) }),
        );
      }
    });
}

function createRevokeSessions({
  withMemberAction,
  isActiveAccount,
  fail,
  setNotice,
  reconcileUnknownMutation,
}: RevokeSessionsDependencies) {
  return (member: Member) =>
    withMemberAction(`sessions:${member.userId}`, async (accountId) => {
      try {
        const result = await teamAccessClient.revokeMemberSessions(accountId, member.userId);
        if (!isActiveAccount(accountId)) return;
        if (result.kind === "unknown" && member.isSelf) {
          window.location.reload();
          return;
        }
        if (result.kind !== "ok") {
          if (result.kind === "unknown") {
            await reconcileUnknownMutation(m.settings_members_unknown_session_revocation());
            return;
          }
          fail(
            null,
            resolveRejectionMessage(result, m.settings_members_err_revoke_sessions({ status: result.status })),
          );
          return;
        }
        setNotice(m.settings_members_sessions_revoked());
        if (member.isSelf) window.location.reload();
      } catch (e) {
        if (member.isSelf) {
          window.location.reload();
          return;
        }
        await reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_session_revocation(),
            error: resolveErrorMessage(e),
          }),
        );
      }
    });
}

export function createMemberCredentialMutations({
  withMemberAction,
  isActiveAccount,
  fail,
  setNotice,
  reconcileUnknownMutation,
  setResetLink,
  bumpReadiness,
}: ResetPasswordDependencies) {
  // Mint a single-use password-reset link for `mem` (P1.18). Password mode only (the button is
  // hidden otherwise; the server 400s regardless). No email is ever sent — the admin copies the
  // link out of the write-once block below and hands it over directly. `mem` is NOT `m` (i18n).
  const resetPassword = createResetPassword({
    withMemberAction,
    isActiveAccount,
    fail,
    setNotice,
    reconcileUnknownMutation,
    setResetLink,
    bumpReadiness,
  });
  const revokeSessions = createRevokeSessions({
    withMemberAction,
    isActiveAccount,
    fail,
    setNotice,
    reconcileUnknownMutation,
  });

  return { resetPassword, revokeSessions };
}
