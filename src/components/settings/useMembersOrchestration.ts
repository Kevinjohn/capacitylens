import { useCallback, useEffect, useRef, useState } from "react";
import { m } from "@/i18n";
import { ACCOUNT_ROLES, type InvitationRole, type MembershipStatus } from "@capacitylens/shared/account/types";
import { can, type Role } from "@capacitylens/shared/domain/access";
import { isAccountEmail } from "@capacitylens/shared/account/validation";
import { accountClient } from "../../account/accountClient";
import {
  rejectionMessage,
  teamAccessClient,
  type TeamInvitation,
  type TeamMember,
} from "../../account/teamAccessClient";
import { startMasquerade } from "../../auth/accountTransition";
import { strictOidcProvider, useAuth } from "../../auth/authContext";
import { refreshAccountSummaries } from "../../auth/useAccountSummaries";
import { isServerConfigured } from "../../data/apiConfig";
import { offlineStateSnapshot } from "../../data/offlineCache";
import { refreshActiveAccountSlice } from "../../data/persist";
import { useOfflineState } from "../../data/useOfflineState";
import { useDeadlineClock } from "../../hooks/useDeadlineClock";
import { useFieldError } from "../../hooks/useFieldError";
import { errorMessage } from "../../lib/errorMessage";
import { readApiError } from "../../lib/readApiError";
import { roleLabel } from "../../lib/accessCopy";
import { useStore } from "../../store/useStore";
import {
  labelFor,
  STATUS_FOR_ACTION,
  type MemberConfirmation,
  type MemberConfirmationAction,
} from "./MemberConfirmations";
import {
  parseWorkspaceReadiness,
  type ReadinessMember,
  type ReadinessRepairLink,
  type WorkspaceReadiness,
} from "./ssoReadiness";
import { useTeamDirectory } from "./useTeamDirectory";

type Member = TeamMember;

// The roles a member can be given here, in the shared vocabulary's own order. Owner is deliberately
// absent: ownership can change only through the explicit atomic transfer. Values only — no labels at
// module scope, because resolving `m.key()` here would freeze the wording to the load-time locale
// (P1.5.2); the labels come from `roleLabel` at render time instead.
const ASSIGNABLE_ROLES: readonly Role[] = ACCOUNT_ROLES.filter((role) => role !== "owner");

export function useMembersOrchestration(activeAccountId: string | null) {
  const { authMode, providers, refreshAuth } = useAuth();
  // Only the strict (non-experimental) OIDC provider's IDENTITY is needed here: the readiness read
  // is keyed on it, and keying on the provider OBJECT would re-fetch whenever an equal-but-new
  // provider list is resolved.
  const strictProviderId = strictOidcProvider(providers)?.id ?? null;
  const offline = useOfflineState();
  const setNotice = useStore((s) => s.setNotice);
  const setActiveAccount = useStore((s) => s.setActiveAccount);
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
  // token server-side can clear the block — see the changeRole / changeStatus clears below.
  const [resetLink, setResetLink] = useState<{
    userId: string;
    link: string;
    member: string;
    expiresAt: string;
  } | null>(null);
  // The pencil dialog's draft. `nextRole` is a draft until Save, so opening the dialog and closing
  // it again is never a write — the old inline select could fire a change on a stray keypress.
  const [roleEdit, setRoleEdit] = useState<{
    member: Member;
    nextRole: Role;
  } | null>(null);
  const [memberConfirmation, setMemberConfirmation] = useState<MemberConfirmation | null>(null);
  // Which row's gear popover is open. Controlled rather than uncontrolled so choosing an action can
  // close the menu before its confirmation appears — an open popover behind a modal is a trap.
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  // Collapsed by default (#175). Disabled and archived memberships are history, not the team: an
  // administrator opens this group deliberately, to reverse a change or clear a row out.
  const [inactiveOpen, setInactiveOpen] = useState(false);
  const [readiness, setReadiness] = useState<WorkspaceReadiness | null>(null);
  const [readinessError, setReadinessError] = useState(false);
  const [readinessRevision, setReadinessRevision] = useState(0);
  const [emailRepair, setEmailRepair] = useState<{ member: ReadinessMember; email: string } | null>(null);
  const [unlinkRepair, setUnlinkRepair] = useState<{
    member: ReadinessMember;
    link: ReadinessRepairLink;
  } | null>(null);
  const reconcileMintedInvite = useCallback((nextInvites: TeamInvitation[]) => {
    setMintedLink((current) =>
      current?.inviteId && !nextInvites.some((invite) => invite.id === current.inviteId && invite.usedAt === null)
        ? null
        : current,
    );
  }, []);

  const enabled = authMode !== "off" && isServerConfigured();
  const {
    members,
    invites,
    signInTrackingEnabled,
    replaceDirectory,
    gate,
    reload,
    reloadInvites,
    busyAction,
    beginAction,
    endAction,
  } = useTeamDirectory({
    enabled,
    activeAccountId,
    offlineReadOnly: offline.readOnly,
    fail,
    onInvitesLoaded: reconcileMintedInvite,
  });
  /** Ask the readiness effect below for a fresh read. Every write that can move a membership, an
   *  email or a federated link can move the cutover projection derived from them. */
  const bumpReadiness = () => setReadinessRevision((value) => value + 1);
  /** The pair nearly every membership write needs: re-read the directory, then the readiness that is
   *  derived from it. */
  const refreshDirectory = () => {
    reload();
    bumpReadiness();
  };
  // Does the SSO readiness panel apply at all? The section must be authorized (`shown`), the deploy
  // must actually have a strict OIDC provider to be ready FOR, and a cached offline session must not
  // be asking the server questions it cannot answer.
  const readinessApplies = gate === "shown" && !offline.readOnly && strictProviderId !== null;
  const actionStatusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (busyAction !== null) actionStatusRef.current?.focus();
  }, [busyAction]);
  // An outstanding invite row flips to "expired" on a wall-clock boundary nothing else re-renders,
  // so the section keeps an alarm on the nearest expiry STILL AHEAD of the clock it renders with —
  // which is why the clock is the picker's argument rather than a `Date.now()` read of its own.
  const renderedAt = useDeadlineClock((clock) => {
    const nextExpiry = invites
      .filter((invite) => invite.usedAt === null)
      .map((invite) => Date.parse(invite.expiresAt))
      .filter((expiry) => Number.isFinite(expiry) && expiry > clock)
      .reduce((nearest, expiry) => Math.min(nearest, expiry), Number.POSITIVE_INFINITY);
    return Number.isFinite(nextExpiry) ? nextExpiry : null;
  });
  useEffect(() => {
    if (!readinessApplies || !activeAccountId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await accountClient.getSsoReadiness(activeAccountId);
        const body: unknown = await response.json().catch(() => null);
        const parsed = parseWorkspaceReadiness(body);
        if (!response.ok || !parsed || parsed.provider.id !== strictProviderId) {
          throw new Error("Invalid SSO readiness response.");
        }
        if (!cancelled) {
          setReadiness(parsed);
          setReadinessError(false);
        }
      } catch (cause) {
        console.error("MembersSection: SSO readiness failed", cause);
        if (!cancelled) {
          setReadiness(null);
          setReadinessError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAccountId, readinessApplies, readinessRevision, strictProviderId]);
  const requestAccountId = (): string => {
    if (!activeAccountId) throw new Error(m.settings_members_err_no_active_account());
    return activeAccountId;
  };
  const isActiveAccount = (accountId: string): boolean => useStore.getState().activeAccountId === accountId;
  const closeActiveAccount = (): void => {
    if (useStore.getState().activeAccountId !== activeAccountId) return;
    // Internal access-loss repair: no authenticated account transition remains possible after the
    // caller's own membership was removed. Close synchronously so the repair notice is not cleared.
    setActiveAccount(null);
    // Membership loss is not an ordinary trip to the picker: do not offer a Back shortcut to a
    // company the caller can no longer open.
    useStore.setState({ previousAccountId: null });
  };

  /**
   * The envelope every member/invite mutation shares, and NOTHING else: resolve the account being
   * written to (no open company throws before anything is attempted), take the single action lock —
   * standing down when another action already holds it — and release the lock however `body` ends.
   *
   * Deliberately thin. Result classification, the reconcile-on-`unknown` calls, which field an error
   * is routed to and what a success does afterwards differ materially per action (a self-mutation
   * reloads the page or re-resolves the caller's access; a write-once token is cleared; some invalid
   * responses are reconciled rather than reported), so each handler keeps its own try/catch around
   * its own sequence rather than passing that sequence in as options.
   */
  const withMemberAction = async (key: string, body: (accountId: string) => Promise<void>): Promise<void> => {
    const accountId = requestAccountId();
    if (!beginAction(key)) return;
    try {
      await body(accountId);
    } finally {
      endAction();
    }
  };

  /** Drop the write-once reset block when the server has already burned that member's token. Every
   *  membership write (upsertMember, setMemberStatus) revokes the target's outstanding reset tokens
   *  — the P1.18 TOCTOU close — so a link still on screen for them is already dead. */
  const clearResetLinkFor = (userId: string): void => {
    if (resetLink?.userId === userId) setResetLink(null);
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
      const nextInvites = inviteResult.value;
      replaceDirectory(memberResult.value, nextInvites);
      bumpReadiness();
      reconcileMintedInvite(nextInvites);
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

  // NB: the callback param is `mem`, NOT `m` — `m` is the imported i18n message catalogue (P1.5.2);
  // a `m: Member` param would shadow it and break the `m.settings_*()` calls in this scope.
  const myRole = members?.find((mem) => mem.isSelf)?.role;
  const mayManageInvites = myRole !== undefined && can(myRole, "manageInvites");
  const mayManageSignInTracking = myRole !== undefined && can(myRole, "manageMemberSignInTracking");
  const changeSignInTracking = (next: boolean) =>
    withMemberAction("member-sign-in-tracking", async (accountId) => {
      try {
        const result = await teamAccessClient.setMemberSignInTracking(accountId, next);
        if (!isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          fail(null, rejectionMessage(result, m.settings_members_err_sign_in_tracking({ status: result.status })));
          reload();
          return;
        }
        setNotice(
          result.value ? m.settings_members_sign_in_tracking_enabled() : m.settings_members_sign_in_tracking_disabled(),
        );
        reload();
      } catch (cause) {
        fail(null, m.settings_err_server({ error: errorMessage(cause) }));
        reload();
      }
    });
  // NB: the param is `mem`, NOT `m` — see myRole above (`m` is the i18n catalogue, not a Member).
  const changeRole = async (mem: Member, nextRole: Role) => {
    if (nextRole === mem.role) return;
    await withMemberAction(`role:${mem.userId}`, async (accountId) => {
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
          fail(null, rejectionMessage(result, m.settings_members_err_change_role({ status: result.status })));
          return;
        }
        setNotice(m.settings_members_role_updated());
        clearResetLinkFor(mem.userId);
        if (mem.isSelf) await refreshCallerAccess();
        refreshDirectory();
      } catch (e) {
        await reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_role_change(),
            error: errorMessage(e),
          }),
          { callerAccessMayHaveChanged: mem.isSelf },
        );
      }
    });
  };

  // NB: the param is `mem`, NOT `m` — see changeRole above (`m` is the i18n catalogue, not a Member).
  const removeMember = (mem: Member) =>
    withMemberAction(`remove:${mem.userId}`, async (accountId) => {
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
          fail(null, rejectionMessage(result, m.settings_members_err_remove({ status: result.status })));
          return;
        }
        setNotice(m.settings_members_removed());
        clearResetLinkFor(mem.userId);
        if (mem.isSelf) {
          await refreshCallerAccess(true);
        }
        refreshDirectory();
      } catch (e) {
        await reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_member_removal(),
            error: errorMessage(e),
          }),
          { callerAccessMayHaveChanged: mem.isSelf },
        );
      }
    });

  // Disable / archive / restore a membership. The row survives with its role intact; every
  // authorization read narrows on status='active', so a non-active membership simply confers
  // nothing. `mem` is NOT `m` (the i18n catalogue) — see changeRole above.
  const changeStatus = async (mem: Member, nextStatus: MembershipStatus) => {
    if (nextStatus === mem.status) return;
    await withMemberAction(`status:${mem.userId}`, async (accountId) => {
      try {
        const result = await teamAccessClient.changeMemberStatus(accountId, mem.userId, nextStatus);
        if (!isActiveAccount(accountId)) return;
        if (result.kind !== "ok") {
          if (result.kind === "unknown") {
            await reconcileUnknownMutation(m.settings_members_unknown_status_change());
            return;
          }
          fail(null, rejectionMessage(result, m.settings_members_err_change_status({ status: result.status })));
          return;
        }
        setNotice(m.settings_members_status_changed());
        clearResetLinkFor(mem.userId);
        refreshDirectory();
      } catch (e) {
        await reconcileUnknownMutation(
          m.settings_members_error_detail({
            message: m.settings_members_unknown_status_change(),
            error: errorMessage(e),
          }),
        );
      }
    });
  };

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

  /** Pick an action from a row's gear menu: dismiss the menu, then raise its confirmation. */
  const chooseMemberAction = (action: MemberConfirmationAction, member: Member) => {
    setOpenMenuFor(null);
    setMemberConfirmation({ action, member });
  };

  const confirmedMemberAction = () => {
    if (!memberConfirmation) return;
    const pending = memberConfirmation;
    setMemberConfirmation(null);
    switch (pending.action) {
      case "masquerade":
        if (activeAccountId) {
          void startMasquerade(activeAccountId, pending.member.userId);
        }
        return;
      case "remove":
        void removeMember(pending.member);
        return;
      case "resetPassword":
        void resetPassword(pending.member);
        return;
      case "revokeSessions":
        void revokeSessions(pending.member);
        return;
      default:
        void changeStatus(pending.member, STATUS_FOR_ACTION[pending.action]);
    }
  };

  const correctSsoEmail = async () => {
    if (!emailRepair) return;
    // Same ordering as the inline sequence: an absent active account is raised before the draft
    // address is validated.
    requestAccountId();
    const email = emailRepair.email.trim().toLowerCase();
    if (!isAccountEmail(email)) {
      fail("sso-email", m.identity_err_email());
      return;
    }
    await withMemberAction(`sso-email:${emailRepair.member.principalId}`, async (accountId) => {
      try {
        const response = await accountClient.correctMemberEmail(accountId, emailRepair.member.principalId, email);
        if (!response.ok) {
          fail("sso-email", (await readApiError(response)) ?? m.settings_sso_correct_email_error());
          return;
        }
        const changedSelf = members?.some((mem) => mem.userId === emailRepair.member.principalId && mem.isSelf);
        setEmailRepair(null);
        setNotice(m.settings_sso_correct_email_done());
        if (changedSelf) {
          window.location.reload();
          return;
        }
        refreshDirectory();
      } catch (cause) {
        console.error("MembersSection: SSO email correction failed", cause);
        fail("sso-email", m.settings_sso_correct_email_error());
      }
    });
  };

  const removeIncorrectSsoLink = (member: ReadinessMember, link: ReadinessRepairLink) =>
    withMemberAction(`sso-unlink:${member.principalId}`, async (accountId) => {
      try {
        const response = await accountClient.removeFederatedLink(accountId, member.principalId, link);
        if (!response.ok) {
          fail(null, (await readApiError(response)) ?? m.settings_sso_remove_link_error());
          return;
        }
        const changedSelf = members?.some((candidate) => candidate.userId === member.principalId && candidate.isSelf);
        setNotice(m.settings_sso_remove_link_done());
        if (changedSelf) {
          window.location.reload();
          return;
        }
        bumpReadiness();
      } catch (cause) {
        console.error("MembersSection: SSO link removal failed", cause);
        fail(null, m.settings_sso_remove_link_error());
      }
    });

  // The directory arrives in one list and splits in two for display (#175). The main table is the
  // team — no "active" heading, because those rows are simply the members. Disabled and archived
  // rows move into the collapsed group below; they keep their badge there, so the two states stay
  // distinguishable without a table each. The server's order (join date, then name) is preserved by
  // filtering rather than re-sorting.
  const grouped = { active: [] as Member[], inactive: [] as Member[] };
  for (const mem of members ?? []) grouped[mem.status === "active" ? "active" : "inactive"].push(mem);
  const activeMembers = members ? grouped.active : null;
  const inactiveMembers = grouped.inactive;
  // Labels are resolved HERE, at render, not at module scope: a locale change must be reflected
  // without reloading the module (P1.5.2). Both the invite form and the pencil's editor offer the
  // same list, so it is built once.
  const roleOptions = ASSIGNABLE_ROLES.map((value) => ({ value, label: roleLabel(value) }));

  return {
    authMode,
    enabled,
    gate,
    error,
    errorField,
    errorId,
    clear,
    reload,
    readinessApplies,
    readiness,
    readinessError,
    emailRepair,
    setEmailRepair,
    unlinkRepair,
    setUnlinkRepair,
    members,
    activeMembers,
    inactiveMembers,
    myRole,
    mayManageInvites,
    mayManageSignInTracking,
    signInTrackingEnabled,
    changeSignInTracking,
    actionStatusRef,
    busyAction,
    inactiveOpen,
    setInactiveOpen,
    resetLink,
    copyLink,
    inviteRole,
    setInviteRole,
    invitePreauth,
    setInvitePreauth,
    mintedLink,
    invites,
    renderedAt,
    submitInvite,
    revokeInvite,
    roleOptions,
    openMenuFor,
    setOpenMenuFor,
    setRoleEdit,
    chooseMemberAction,
    memberConfirmation,
    setMemberConfirmation,
    confirmedMemberAction,
    roleEdit,
    changeRole,
    correctSsoEmail,
    removeIncorrectSsoLink,
  };
}
