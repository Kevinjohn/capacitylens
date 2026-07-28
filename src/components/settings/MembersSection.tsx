import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { isServerConfigured } from "../../data/apiConfig";
import { useAuth } from "../../auth/authContext";
import { useStore } from "../../store/useStore";
import { useFieldError } from "../../hooks/useFieldError";
import { errorMessage } from "../../lib/errorMessage";
import { ConfirmDialog, SelectField, TextField } from "../common/ui";
import { m } from "@/i18n";
import { can, canManageMemberRole, canRemoveMember, type Role } from "@capacitylens/shared/domain/access";
import type { InvitationRole } from "@capacitylens/shared/account/types";
import { teamAccessClient, type TeamInvitation, type TeamMember } from "../../account/teamAccessClient";
import { MAX_EMAIL_LENGTH } from "@capacitylens/shared/lib/strings";
import { roleLabel, roleSummary } from "../../lib/accessCopy";
import { refreshAccountSummaries } from "../../auth/useAccountSummaries";
import { refreshActiveAccountSlice } from "../../data/persist";
import { offlineStateSnapshot } from "../../data/offlineCache";
import { useOfflineState } from "../../data/useOfflineState";
import { useTeamDirectory } from "./useTeamDirectory";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { FieldError, FieldSet, FieldLegend } from "../ui/field";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";

// Member-management section shown in Team & access on an auth-enabled, server-backed deploy.
// Owner/Admin list members, change a member's role, revoke a member, and list/revoke outstanding
// invites + mint a new invite (link + optional email-preauth, reusing POST /api/invites). The CLIENT
// gate is courtesy only — the SAME pure guards (canManageMemberRole / canRemoveMember) hide controls
// the user can't use, but the SERVER is the backstop (every route is gated server-side; a 403 on the
// initial members fetch is what hides the whole section for a viewer/editor). The invite TOKEN is
// shown exactly ONCE, straight from the create response — it is write-once and never read back.

type Member = TeamMember;
type MemberConfirmationAction = "remove" | "resetPassword" | "revokeSessions";
type MemberConfirmation = { action: MemberConfirmationAction; member: Member };

// Each role's label is a GETTER (`() => m.key()`), not a pre-resolved string (the AppShell LINKS
// pattern, P1.5.2): this list is module-scope, so resolving `m.key()` here would freeze the label to
// the load-time locale. The getter defers it to render — roleOptions() calls each at its call site.
const ALL_ROLE_OPTIONS: { value: Role; label: () => string }[] = [
  { value: "admin", label: () => m.settings_role_admin() },
  { value: "editor", label: () => m.settings_role_editor() },
  { value: "viewer", label: () => m.settings_role_viewer() },
];

// Owner is deliberately absent: ownership can change only through the explicit atomic transfer.
// Labels are resolved at render time so a locale change is reflected without reloading the module.
function roleOptions(): { value: Role; label: string }[] {
  return ALL_ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label() }));
}

function labelFor(m: Member): string {
  const name = m.name?.trim();
  if (name && m.email) return `${name} (${m.email})`;
  return name || m.email || m.userId;
}

function confirmationCopy({ action, member }: MemberConfirmation): {
  title: string;
  confirmLabel: string;
  message: string;
} {
  switch (action) {
    case "remove":
      return {
        title: m.settings_remove_member_title(),
        confirmLabel: m.settings_member_remove(),
        message: member.isSelf
          ? m.settings_remove_self_message()
          : m.settings_remove_member_message({ member: labelFor(member) }),
      };
    case "resetPassword":
      return {
        title: m.settings_reset_password_title(),
        confirmLabel: m.settings_member_reset_password(),
        message: m.settings_reset_password_message({
          member: labelFor(member),
        }),
      };
    case "revokeSessions":
      return {
        title: m.settings_revoke_sessions_title(),
        confirmLabel: m.settings_member_revoke_sessions(),
        message: member.isSelf
          ? m.settings_revoke_self_sessions_message()
          : m.settings_revoke_sessions_message({ member: labelFor(member) }),
      };
  }
}

/**
 * A write-once "here is a freshly-minted link, copy it now" block (shared by the invite link and the
 * password-reset link). Renders the `break-all` <code> + ghost copy Button once; the token behind the
 * link is never read back. Pass `intro` (a <p>) to prepend an explanatory line — the reset block uses
 * it to name WHO/when; the invite block omits it. Structure is intentionally two shapes (the intro
 * variant needs an outer vertical stack) so both call sites keep their exact prior markup.
 */
function CopyableLinkBlock({
  link,
  testId,
  copiedNotice,
  copyLabel,
  copyLink,
  intro,
}: {
  link: string;
  testId: string;
  copiedNotice: string;
  copyLabel: string;
  copyLink: (link: string, copiedNotice: string) => void;
  intro?: ReactNode;
}) {
  const code = (
    <code data-testid={testId} className="min-w-0 flex-1 break-all text-xs text-ink">
      {link}
    </code>
  );
  const button = (
    <Button aria-label={copyLabel} size="sm" variant="outline" onClick={() => copyLink(link, copiedNotice)}>
      {m.settings_invite_copy()}
    </Button>
  );
  if (intro) {
    return (
      <div className="mb-4 flex flex-col gap-2 rounded bg-canvas p-2">
        {intro}
        <div className="flex flex-wrap items-center gap-2">
          {code}
          {button}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded bg-canvas p-2">
      {code}
      {button}
    </div>
  );
}

/**
 * The Team & access member-management section. Renders ONLY in server + auth-on mode; a 403 on the initial
 * members read self-gates it away for a viewer/editor (renders nothing). Owner/Admin affordances are
 * gated client-side via the shared pure guards (Owner actions hidden for an Admin; Owner membership
 * stays outside ordinary role/removal controls). The server enforces all of it regardless.
 */
export function MembersSection() {
  const activeAccountId = useStore((s) => s.activeAccountId);
  return <AccountMembersSection key={activeAccountId ?? "no-active-account"} activeAccountId={activeAccountId} />;
}

/** Account-keyed implementation. Changing companies remounts this boundary, which discards
 * account-local drafts, confirmations, action locks and write-once bearer links together. */
function AccountMembersSection({ activeAccountId }: { activeAccountId: string | null }) {
  const [renderedAt, setRenderedAt] = useState(() => Date.now());
  const { authMode, refreshAuth } = useAuth();
  const offline = useOfflineState();
  const setActiveAccount = useStore((s) => s.setActiveAccount);
  const setNotice = useStore((s) => s.setNotice);
  const invalidateMemberships = useStore((s) => s.invalidateMemberships);
  const { error, errorField, errorId, fail, clear } = useFieldError();

  const [inviteRole, setInviteRole] = useState<InvitationRole>("editor");
  const [invitePreauth, setInvitePreauth] = useState("");
  // The freshly-minted link, shown ONCE after a successful create (the token is write-once). Keep
  // its non-secret invite id so a revoke or authoritative list refresh can clear a now-dead link.
  const [mintedLink, setMintedLink] = useState<{
    inviteId: string | null;
    link: string;
  } | null>(null);
  // The freshly-minted password-reset link (P1.18) — same write-once posture as the invite link,
  // labelled with WHO it resets so an admin juggling several members can't hand out the wrong one.
  // `userId` is carried (not just the display label) so a membership write that burns this member's
  // token server-side can clear the block — see the changeRole / transferOwnership clears below.
  const [resetLink, setResetLink] = useState<{
    userId: string;
    link: string;
    member: string;
    expiresAt: string;
  } | null>(null);
  const [transferTarget, setTransferTarget] = useState<Member | null>(null);
  const [roleChange, setRoleChange] = useState<{
    member: Member;
    nextRole: Role;
  } | null>(null);
  const [memberConfirmation, setMemberConfirmation] = useState<MemberConfirmation | null>(null);
  const reconcileMintedInvite = useCallback((nextInvites: TeamInvitation[]) => {
    setMintedLink((current) =>
      current?.inviteId && !nextInvites.some((invite) => invite.id === current.inviteId && invite.usedAt === null)
        ? null
        : current,
    );
  }, []);

  const enabled = authMode !== "off" && isServerConfigured();
  const { members, invites, replaceDirectory, gate, reload, busyAction, beginAction, endAction } = useTeamDirectory({
    enabled,
    activeAccountId,
    offlineReadOnly: offline.readOnly,
    fail,
    onInvitesLoaded: reconcileMintedInvite,
  });
  useEffect(() => {
    const nextExpiry = invites
      .filter((invite) => invite.usedAt === null)
      .map((invite) => Date.parse(invite.expiresAt))
      .filter((expiry) => Number.isFinite(expiry) && expiry > renderedAt)
      .reduce((nearest, expiry) => Math.min(nearest, expiry), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(
      () => setRenderedAt(Date.now()),
      Math.min(nextExpiry - Date.now() + 1, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [invites, renderedAt]);
  const requestAccountId = (): string => {
    if (!activeAccountId) throw new Error(m.settings_members_err_no_active_account());
    return activeAccountId;
  };
  const isActiveAccount = (accountId: string): boolean => useStore.getState().activeAccountId === accountId;
  const closeActiveAccount = (): void => {
    if (useStore.getState().activeAccountId !== activeAccountId) return;
    setActiveAccount(null);
    // Membership loss is not an ordinary trip to the picker: do not offer a Back shortcut to a
    // company the caller can no longer open.
    useStore.setState({ previousAccountId: null });
  };

  /** Re-resolve every caller-owned projection after a possible self-role mutation. The role badge
   * and affordances fail closed immediately via membershipRevision; the tenant slice is then fetched
   * again under the new server role so confidential fields from the old projection cannot linger. */
  const refreshCallerAccess = async (knownRemoved = false): Promise<"active" | "left" | "failed"> => {
    const accountId = activeAccountId;
    if (!accountId) return "failed";
    invalidateMemberships();
    await refreshAuth();
    if (!isActiveAccount(accountId)) return "left";
    const summaries = await refreshAccountSummaries({
      allowCachedFallback: false,
    });
    if (!isActiveAccount(accountId)) return "left";
    // A cached fallback is useful for ordinary offline viewing but is not evidence of the caller's
    // post-mutation role. Fail closed instead of accepting a stale membership list as authority.
    if (summaries === null || offlineStateSnapshot().readOnly) {
      closeActiveAccount();
      setNotice(m.settings_members_access_refresh_failed(), "error");
      return "failed";
    }
    const stillMember = !knownRemoved && summaries.some((account) => account.id === accountId);
    if (!stillMember) {
      closeActiveAccount();
      return "left";
    }
    const outcome = await refreshActiveAccountSlice(accountId);
    if (!isActiveAccount(accountId)) return "left";
    // `refreshActiveAccountSlice` can report `reloaded` after restoring an offline snapshot. That is
    // still not an authoritative post-role projection: close the tenant so confidential fields
    // from the caller's previous role cannot remain visible under an unverified role badge.
    if (outcome === "reloaded" && !offlineStateSnapshot().readOnly) return "active";
    // A user-initiated tenant switch can legitimately supersede this refresh. Never close the new
    // tenant or replace its notice because a stale operation finished late.
    closeActiveAccount();
    setNotice(m.settings_members_access_refresh_failed(), "error");
    return "failed";
  };

  const reconcileUnknownMutation = async (
    message: string,
    { callerAccessMayHaveChanged = false }: { callerAccessMayHaveChanged?: boolean } = {},
  ): Promise<void> => {
    const accountId = requestAccountId();
    if (!isActiveAccount(accountId)) return;
    const accessResult = callerAccessMayHaveChanged ? await refreshCallerAccess() : null;
    if (!isActiveAccount(accountId)) return;
    if (accessResult === "failed") return;
    if (accessResult === "left") {
      setNotice(m.settings_members_reconcile_company_access({ message }), "warning");
      return;
    }
    try {
      const [memberResult, inviteResult] = await Promise.all([
        teamAccessClient.listMembers(accountId),
        teamAccessClient.listInvitations(accountId),
      ]);
      if (!isActiveAccount(accountId)) return;
      if (memberResult.kind !== "ok" || inviteResult.kind !== "ok") {
        throw new Error(m.settings_members_err_authoritative_reload());
      }
      const nextMembers = memberResult.value;
      const nextInvites = inviteResult.value;
      replaceDirectory(nextMembers, nextInvites);
      setMintedLink((current) =>
        current?.inviteId && !nextInvites.some((invite) => invite.id === current.inviteId && invite.usedAt === null)
          ? null
          : current,
      );
      setNotice(m.settings_members_reconcile_directory({ message }), "warning");
    } catch (reloadError) {
      if (!isActiveAccount(accountId)) return;
      if (accessResult === "active") {
        setNotice(m.settings_members_reconcile_access({ message }), "warning");
      } else {
        fail(
          null,
          m.settings_members_reconcile_reload_failed({
            message,
            error: errorMessage(reloadError),
          }),
        );
      }
    }
  };

  if (!enabled) return null; // OFF / demo build: the section does not exist.
  // Privileged controls stay fail-closed until the current account's members read authorizes this
  // section. A 403 remains hidden, and a switch cannot briefly expose the next account's form while
  // its authorization request is still pending.
  if (gate === "loading" || gate === "hidden") return null;
  if (gate === "error") {
    return (
      <Card data-testid="members-section">
        <CardHeader>
          <CardTitle>
            <h2>{m.settings_members_heading()}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <FieldError id={errorId}>{error}</FieldError>
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            {m.settings_members_retry()}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const myRole = members?.find((m) => m.isSelf)?.role;
  const mayManageInvites = myRole !== undefined && can(myRole, "manageInvites");
  const mayTransferOwnership = myRole !== undefined && can(myRole, "transferOwnership");
  // NB: the param is `mem`, NOT `m` — `m` is the imported i18n message catalogue (P1.5.2); a
  // `m: Member` param would shadow it and break the `m.settings_*()` calls in this scope.
  const changeRole = async (mem: Member, nextRole: Role) => {
    if (nextRole === mem.role) return;
    const accountId = requestAccountId();
    if (!beginAction(`role:${mem.userId}`)) return;
    try {
      const result = await teamAccessClient.changeMemberRole(accountId, mem.userId, nextRole);
      if (!isActiveAccount(accountId)) return;
      if (result.kind !== "ok") {
        if (result.kind === "unknown") {
          await reconcileUnknownMutation(m.settings_members_unknown_role_change(), {
            callerAccessMayHaveChanged: mem.isSelf,
          });
          return;
        }
        fail(
          null,
          result.kind === "rejected" && result.message
            ? result.message
            : m.settings_members_err_change_role({ status: result.status }),
        );
        return;
      }
      setNotice(m.settings_members_role_updated());
      // The write-once block must never keep displaying a link the server has already revoked:
      // upsertMember burns THIS member's outstanding reset tokens on every membership write (the
      // P1.18 TOCTOU close), so a role change to the shown member kills that link server-side.
      if (resetLink?.userId === mem.userId) setResetLink(null);
      if (mem.isSelf) await refreshCallerAccess();
      reload();
    } catch (e) {
      await reconcileUnknownMutation(
        m.settings_members_error_detail({
          message: m.settings_members_unknown_role_change(),
          error: errorMessage(e),
        }),
        { callerAccessMayHaveChanged: mem.isSelf },
      );
    } finally {
      endAction();
    }
  };

  // NB: the param is `mem`, NOT `m` — see changeRole above (`m` is the i18n catalogue, not a Member).
  const removeMember = async (mem: Member) => {
    const accountId = requestAccountId();
    if (!beginAction(`remove:${mem.userId}`)) return;
    try {
      const result = await teamAccessClient.removeMember(accountId, mem.userId);
      if (!isActiveAccount(accountId)) return;
      if (result.kind !== "ok") {
        if (result.kind === "unknown") {
          await reconcileUnknownMutation(m.settings_members_unknown_member_removal(), {
            callerAccessMayHaveChanged: mem.isSelf,
          });
          return;
        }
        fail(
          null,
          result.kind === "rejected" && result.message
            ? result.message
            : m.settings_members_err_remove({ status: result.status }),
        );
        return;
      }
      setNotice(m.settings_members_removed());
      if (resetLink?.userId === mem.userId) setResetLink(null);
      if (mem.isSelf) {
        await refreshCallerAccess(true);
      }
      reload();
    } catch (e) {
      await reconcileUnknownMutation(
        m.settings_members_error_detail({
          message: m.settings_members_unknown_member_removal(),
          error: errorMessage(e),
        }),
        { callerAccessMayHaveChanged: mem.isSelf },
      );
    } finally {
      endAction();
    }
  };

  // Transfer ownership to `mem` and step the caller down to admin (server-atomic, owner-only). The
  // confirmation makes the loss of Owner authority explicit; only the new owner can hand it back.
  const transferOwnership = async (mem: Member) => {
    const accountId = requestAccountId();
    if (!beginAction(`transfer:${mem.userId}`)) return;
    try {
      const result = await teamAccessClient.transferOwnership(accountId, mem.userId);
      if (!isActiveAccount(accountId)) return;
      if (result.kind !== "ok") {
        if (result.kind === "unknown") {
          await reconcileUnknownMutation(m.settings_members_unknown_ownership_transfer(), {
            callerAccessMayHaveChanged: true,
          });
          return;
        }
        fail(
          null,
          result.kind === "rejected" && result.message
            ? result.message
            : m.settings_members_err_transfer({ status: result.status }),
        );
        return;
      }
      setNotice(m.settings_members_ownership_transferred());
      // transferOwnership does TWO upserts in one tx — promoting `mem` AND demoting the caller — so
      // the server burns outstanding reset tokens for BOTH. Clear the write-once block if it shows a
      // link for either party, so we never hand out a link the server has already revoked (same
      // reason as the changeRole clear above). `mm` is NOT `m` (the i18n catalogue).
      const selfUserId = members?.find((mm) => mm.isSelf)?.userId;
      if (resetLink && (resetLink.userId === mem.userId || resetLink.userId === selfUserId)) {
        setResetLink(null);
      }
      await refreshCallerAccess();
      reload();
    } catch (e) {
      await reconcileUnknownMutation(
        m.settings_members_error_detail({
          message: m.settings_members_unknown_ownership_transfer(),
          error: errorMessage(e),
        }),
        { callerAccessMayHaveChanged: true },
      );
    } finally {
      endAction();
    }
  };

  // Mint a single-use password-reset link for `mem` (P1.18). Password mode only (the button is
  // hidden otherwise; the server 400s regardless). No email is ever sent — the admin copies the
  // link out of the write-once block below and hands it over directly. `mem` is NOT `m` (i18n).
  const resetPassword = async (mem: Member) => {
    const accountId = requestAccountId();
    if (!beginAction(`reset:${mem.userId}`)) return;
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
      // changeRole / transferOwnership clears above).
      setResetLink({
        userId: mem.userId,
        link: `${window.location.origin}/reset-password/${encodeURIComponent(body.token)}`,
        member: labelFor(mem),
        expiresAt: body.expiresAt,
      });
      setNotice(m.settings_members_reset_created());
    } catch (e) {
      await reconcileUnknownMutation(
        m.settings_members_unknown_reset_request_failed({
          error: errorMessage(e),
        }),
      );
    } finally {
      endAction();
    }
  };

  const revokeSessions = async (mem: Member) => {
    const accountId = requestAccountId();
    if (!beginAction(`sessions:${mem.userId}`)) return;
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
        fail(
          null,
          result.kind === "rejected" && result.message
            ? result.message
            : m.settings_members_err_revoke_sessions({ status: result.status }),
        );
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
    } finally {
      endAction();
    }
  };

  const submitInvite = async () => {
    clear();
    const accountId = requestAccountId();
    const trimmed = invitePreauth.trim();
    if (trimmed.length > MAX_EMAIL_LENGTH || (trimmed.length > 0 && !/^[^@\s]+@[^@\s]+$/.test(trimmed))) {
      fail("invite", m.identity_err_email());
      return;
    }
    if (!beginAction("invite:create")) return;
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
      reload();
    } catch (e) {
      await reconcileUnknownMutation(
        m.settings_members_error_detail({
          message: m.settings_members_unknown_invite_creation(),
          error: errorMessage(e),
        }),
      );
    } finally {
      endAction();
    }
  };

  const revokeInvite = async (id: string) => {
    const accountId = requestAccountId();
    if (!beginAction(`invite:revoke:${id}`)) return;
    try {
      const result = await teamAccessClient.revokeInvitation(accountId, id);
      if (!isActiveAccount(accountId)) return;
      if (result.kind !== "ok") {
        if (result.kind === "unknown") {
          await reconcileUnknownMutation(m.settings_members_unknown_invite_revocation());
          return;
        }
        fail(
          null,
          result.kind === "rejected" && result.message
            ? result.message
            : m.settings_members_err_revoke_invite({ status: result.status }),
        );
        return;
      }
      setNotice(m.settings_members_invite_revoked());
      setMintedLink((current) => (current?.inviteId === id ? null : current));
      reload();
    } catch (e) {
      await reconcileUnknownMutation(
        m.settings_members_error_detail({
          message: m.settings_members_unknown_invite_revocation(),
          error: errorMessage(e),
        }),
      );
    } finally {
      endAction();
    }
  };

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

  const confirmedMemberAction = () => {
    if (!memberConfirmation) return;
    const pending = memberConfirmation;
    setMemberConfirmation(null);
    if (pending.action === "remove") {
      void removeMember(pending.member);
    } else if (pending.action === "resetPassword") {
      void resetPassword(pending.member);
    } else {
      void revokeSessions(pending.member);
    }
  };

  const memberConfirmationCopy = memberConfirmation ? confirmationCopy(memberConfirmation) : null;

  return (
    <>
      <Card data-testid="members-section" aria-busy={busyAction !== null}>
        <CardHeader>
          <CardTitle>
            <h2>{m.settings_members_heading()}</h2>
          </CardTitle>
          <CardDescription>{m.settings_members_intro()}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p role="status" aria-live="polite" className="sr-only">
            {busyAction ? m.settings_members_updating() : ""}
          </p>
          <FieldError id={errorId}>{errorField === null ? error : null}</FieldError>

          {/* Members list */}
          {members && members.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{m.settings_members_empty()}</p>
          ) : (
            <ItemGroup>
              {members?.map((mem, index) => {
                // NB: the row var is `mem`, NOT `m` — `m` is the imported i18n message catalogue (P1.5.2);
                // shadowing it here would make `m.settings_*()` resolve against the Member object instead.
                // Ordinary role changes never touch the Owner. Ownership uses the explicit transfer below.
                const representativeRole: Role = mem.role === "viewer" ? "editor" : "viewer";
                const mayTouch = !!myRole && canManageMemberRole(myRole, mem.role, representativeRole);
                const isOwner = mem.role === "owner";
                const mayRemove = !!myRole && canRemoveMember(myRole, mem.role);
                const memberLabel = labelFor(mem);
                // Reset links exist only in PASSWORD mode ('sso' delegates credentials to the IdP; the
                // server 400s there regardless) and never for a target an admin can't touch (e.g. an owner,
                // or a member who owns another account — a reset link is an account-takeover capability).
                // We trust the SERVER-computed `mayResetPassword`: it already folds in the cross-account +
                // self-exemption checks the per-account pure guard can't see AND returns `false` in SSO mode,
                // so the old `authMode === 'password'` / `myRole` conditions here would be redundant.
                const mayReset = mem.mayResetPassword;
                return (
                  <Fragment key={mem.userId}>
                    {index > 0 && <ItemSeparator />}
                    <Item size="sm" role="listitem" className="rounded-none px-0" data-testid="member-row">
                      <ItemContent className="min-w-0">
                        <span className="text-sm text-ink">{memberLabel}</span>
                        {mem.isSelf && (
                          <span className="ml-1 text-xs text-muted-foreground">{m.settings_member_you()}</span>
                        )}
                        <span className="ml-2 text-xs text-muted-foreground">· {mem.status}</span>
                      </ItemContent>
                      <ItemActions className="flex-wrap justify-end">
                        {mayTouch ? (
                          <span data-testid="member-role-select">
                            <SelectField
                              label={m.settings_member_role_label()}
                              ariaLabel={m.settings_member_role_aria({
                                member: memberLabel,
                              })}
                              value={mem.role}
                              onChange={(v) =>
                                setRoleChange({
                                  member: mem,
                                  nextRole: v as Role,
                                })
                              }
                              options={roleOptions()}
                              disabled={busyAction !== null}
                            />
                          </span>
                        ) : (
                          <span className="text-sm capitalize text-muted-foreground">{mem.role}</span>
                        )}
                        {mayReset && (
                          <Button
                            aria-label={m.settings_member_reset_password_aria({
                              member: memberLabel,
                            })}
                            size="sm"
                            variant="outline"
                            data-testid="member-reset-password"
                            disabled={busyAction !== null}
                            onClick={() =>
                              setMemberConfirmation({
                                action: "resetPassword",
                                member: mem,
                              })
                            }
                          >
                            {m.settings_member_reset_password()}
                          </Button>
                        )}
                        {mem.mayRevokeSessions && (
                          <Button
                            aria-label={m.settings_member_revoke_sessions_aria({
                              member: memberLabel,
                            })}
                            size="sm"
                            variant="outline"
                            data-testid="member-revoke-sessions"
                            disabled={busyAction !== null}
                            onClick={() =>
                              setMemberConfirmation({
                                action: "revokeSessions",
                                member: mem,
                              })
                            }
                          >
                            {m.settings_member_revoke_sessions()}
                          </Button>
                        )}
                        {mayRemove && (
                          <Button
                            aria-label={m.settings_member_remove_aria({
                              member: memberLabel,
                            })}
                            size="sm"
                            variant="danger-soft"
                            data-testid="member-remove"
                            disabled={busyAction !== null}
                            onClick={() =>
                              setMemberConfirmation({
                                action: "remove",
                                member: mem,
                              })
                            }
                          >
                            {m.settings_member_remove()}
                          </Button>
                        )}
                        {/* Ownership has one path: a confirmed, atomic hand-over that promotes the target and
                    demotes the caller. Generic role selectors never offer Owner. */}
                        {mayTransferOwnership && !mem.isSelf && mem.role !== "owner" && (
                          <Button
                            aria-label={m.settings_member_make_owner_aria({
                              member: memberLabel,
                            })}
                            size="sm"
                            variant="outline"
                            data-testid="member-make-owner"
                            disabled={busyAction !== null}
                            onClick={() => setTransferTarget(mem)}
                          >
                            {m.settings_member_make_owner()}
                          </Button>
                        )}
                        {isOwner && (
                          <span className="text-xs text-muted-foreground">
                            {m.settings_member_sole_owner_protected()}
                          </span>
                        )}
                      </ItemActions>
                    </Item>
                  </Fragment>
                );
              })}
            </ItemGroup>
          )}

          {/* Freshly-minted password-reset link (P1.18) — write-once, same posture as the invite link
          below: shown straight from the create response and never read back. Named + dated so the
          admin hands the right link to the right person before it disappears. */}
          {resetLink && (
            <CopyableLinkBlock
              link={resetLink.link}
              testId="reset-link"
              copiedNotice={m.settings_members_reset_copied()}
              copyLabel={m.settings_reset_copy_aria({
                member: resetLink.member,
              })}
              copyLink={copyLink}
              intro={
                <p className="text-xs text-muted-foreground">
                  {m.settings_members_reset_intro({
                    member: resetLink.member,
                    // Local date + TIME, not a bare UTC .slice(0,10): the link lives only 24h, so a
                    // date-only string (and a UTC one at that) misleads by up to a day in non-UTC zones
                    // and hides the hour it dies. toLocaleString renders the viewer's wall clock.
                    when: new Date(resetLink.expiresAt).toLocaleString(),
                  })}
                </p>
              }
            />
          )}

          {/* Invite form */}
          {mayManageInvites && (
            <FieldSet className="gap-2 rounded-md border p-3">
              <FieldLegend variant="label">{m.settings_invite_heading()}</FieldLegend>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-40">
                  <SelectField
                    label={m.settings_invite_role_label()}
                    ariaLabel={m.settings_invite_role_aria()}
                    value={inviteRole}
                    onChange={(value) => setInviteRole(value as InvitationRole)}
                    disabled={busyAction !== null}
                    options={roleOptions()}
                    testId="invite-role"
                  />
                </div>
                <div className="min-w-48 flex-1">
                  <TextField
                    label={m.settings_invite_preauth_label()}
                    ariaLabel={m.settings_invite_preauth_aria()}
                    type="email"
                    value={invitePreauth}
                    maxLength={MAX_EMAIL_LENGTH}
                    onChange={(next) => {
                      setInvitePreauth(next);
                      if (errorField === "invite") clear();
                    }}
                    disabled={busyAction !== null}
                    invalid={errorField === "invite"}
                    describedById={errorId}
                    placeholder={m.settings_invite_preauth_placeholder()}
                    testId="invite-preauth"
                  />
                </div>
                <Button
                  size="sm"
                  data-testid="invite-submit"
                  disabled={busyAction !== null}
                  onClick={() => void submitInvite()}
                >
                  {m.settings_invite_submit()}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground" data-testid="invite-role-summary" aria-live="polite">
                {roleSummary(inviteRole)}
              </p>
              <FieldError id={errorId}>{errorField === "invite" ? error : null}</FieldError>
              {mintedLink && (
                <CopyableLinkBlock
                  link={mintedLink.link}
                  testId="invite-link"
                  copiedNotice={m.settings_members_invite_copied()}
                  copyLabel={m.settings_invite_copy_aria()}
                  copyLink={copyLink}
                />
              )}
            </FieldSet>
          )}

          {/* Outstanding invites */}
          {mayManageInvites && invites.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="mb-1 text-xs font-semibold text-ink">{m.settings_invites_outstanding_heading()}</h3>
              <ItemGroup>
                {invites.map((inv, index) => {
                  const expired = Date.parse(inv.expiresAt) <= renderedAt;
                  const actionable = inv.usedAt === null && !expired;
                  return (
                    <Fragment key={inv.id}>
                      {index > 0 && <ItemSeparator />}
                      <Item size="sm" role="listitem" className="rounded-none px-0" data-testid="invite-row">
                        <ItemContent className="text-sm text-ink">
                          <span className="capitalize">{inv.role}</span>
                          {inv.preauthEmail
                            ? m.settings_invite_suffix_email({
                                email: inv.preauthEmail,
                              })
                            : m.settings_invite_suffix_link()}
                          {inv.usedAt
                            ? m.settings_invite_suffix_used()
                            : expired
                              ? m.settings_invite_suffix_expired()
                              : // Invite validity spans several days, so keep this compact row date-only while
                                // rendering the date on the viewer's local calendar rather than slicing UTC.
                                m.settings_invite_suffix_expires({
                                  date: new Date(inv.expiresAt).toLocaleDateString(),
                                })}
                        </ItemContent>
                        {actionable && (
                          <ItemActions>
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid="invite-revoke"
                              disabled={busyAction !== null}
                              onClick={() => void revokeInvite(inv.id)}
                            >
                              {m.settings_invite_revoke()}
                            </Button>
                          </ItemActions>
                        )}
                      </Item>
                    </Fragment>
                  );
                })}
              </ItemGroup>
            </div>
          )}
        </CardContent>
      </Card>
      {memberConfirmation && memberConfirmationCopy && (
        <ConfirmDialog
          title={memberConfirmationCopy.title}
          confirmLabel={memberConfirmationCopy.confirmLabel}
          message={memberConfirmationCopy.message}
          onConfirm={confirmedMemberAction}
          onCancel={() => setMemberConfirmation(null)}
        />
      )}
      {transferTarget && (
        <ConfirmDialog
          title={m.settings_transfer_owner_title()}
          confirmLabel={m.settings_member_make_owner()}
          message={m.settings_transfer_owner_message({
            member: labelFor(transferTarget),
          })}
          onConfirm={() => {
            const target = transferTarget;
            setTransferTarget(null);
            void transferOwnership(target);
          }}
          onCancel={() => setTransferTarget(null)}
        />
      )}
      {roleChange && (
        <ConfirmDialog
          title={m.settings_change_role_title()}
          confirmLabel={m.settings_change_role_confirm()}
          confirmVariant="default"
          message={m.settings_change_role_message({
            member: labelFor(roleChange.member),
            role: roleLabel(roleChange.nextRole),
            summary: roleSummary(roleChange.nextRole),
          })}
          onConfirm={() => {
            const pending = roleChange;
            setRoleChange(null);
            void changeRole(pending.member, pending.nextRole);
          }}
          onCancel={() => setRoleChange(null)}
        />
      )}
    </>
  );
}
