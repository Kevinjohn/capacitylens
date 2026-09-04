import { m } from "@/i18n";
import { rejectionMessage, teamAccessClient, type TeamMember as Member } from "../../account/teamAccessClient";
import { errorMessage } from "../../lib/errorMessage";
import { labelFor } from "./memberConfirmationCopy";
import type { MemberMutationDependencies } from "./memberMutations";

export function memberCredentialMutations({
  withMemberAction,
  isActiveAccount,
  fail,
  setNotice,
  reconcileUnknownMutation,
  setResetLink,
  bumpReadiness,
}: Pick<
  MemberMutationDependencies,
  | "withMemberAction"
  | "isActiveAccount"
  | "fail"
  | "setNotice"
  | "reconcileUnknownMutation"
  | "setResetLink"
  | "bumpReadiness"
>) {
  // Mint a single-use password-reset link for `mem` (P1.18). Password mode only (the button is
  // hidden otherwise; the server 400s regardless). No email is ever sent — the admin copies the
  // link out of the write-once block below and hands it over directly. `mem` is NOT `m` (i18n).
  const resetPassword = (mem: Member) =>
    withMemberAction(`reset:${mem.userId}`, async (accountId) => {
      setResetLink(null);
      try {
        const result = await teamAccessClient.issuePasswordReset(accountId, mem.userId);
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
        if (!body?.expiresAt) {
          await reconcileUnknownMutation(m.settings_members_unknown_reset_value_lost());
          return;
        }
        // Write-once: build + show the link straight from this response and never again. `userId` is
        // carried so a later membership write on this member can clear the stale block (see the
        // clearResetLinkFor calls above).
        setResetLink({
          userId: mem.userId,
          link: `${window.location.origin}/reset-password/${encodeURIComponent(body.token)}`,
          member: labelFor(mem),
          expiresAt: body.expiresAt,
        });
        setNotice(m.settings_members_reset_created());
        // The readiness read DOES move here, despite this touching no membership: preflight reports
        // every principal with an outstanding reset ceremony as an `outstanding_password_reset`
        // global issue (server/src/accounts/ssoCutover.ts), which the panel lists, and the link just
        // minted creates exactly one.
        bumpReadiness();
      } catch (e) {
        await reconcileUnknownMutation(
          m.settings_members_unknown_reset_request_failed({
            error: errorMessage(e),
          }),
        );
      }
    });

  const revokeSessions = (mem: Member) =>
    withMemberAction(`sessions:${mem.userId}`, async (accountId) => {
      try {
        const result = await teamAccessClient.revokeMemberSessions(accountId, mem.userId);
        if (!isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          if (result.kind === "unknown") {
            if (mem.isSelf) {
              // The command may have invalidated this browser's own session. Re-enter through the
              // auth wall; sessionStorage retains the command identity if an operator retries.
              window.location.reload();
              return;
            }
            await reconcileUnknownMutation(m.settings_members_unknown_session_revocation());
            return;
          }
          fail(null, rejectionMessage(result, m.settings_members_err_revoke_sessions({ status: result.status })));
          return;
        }
        setNotice(m.settings_members_sessions_revoked());
        if (mem.isSelf) window.location.reload();
      } catch (e) {
        if (mem.isSelf) {
          // A rejected transport promise can still follow a committed server-side revocation. Do not
          // leave tenant data rendered under a session whose validity is now unknown.
          window.location.reload();
          return;
        }
        await reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_session_revocation(),
            error: errorMessage(e),
          }),
        );
      }
    });

  return { resetPassword, revokeSessions };
}
