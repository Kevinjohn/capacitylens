import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { isServerConfigured } from "../../data/apiConfig";
import { useAuth } from "../../auth/authContext";
import { useStore } from "../../store/useStore";
import { useFieldError } from "../../hooks/useFieldError";
import { errorMessage } from "../../lib/errorMessage";
import { ConfirmDialog, Modal, SelectField, TextField } from "../common/ui";
import { m } from "@/i18n";
import {
  can,
  canChangeMemberStatus,
  canManageMemberRole,
  canRemoveMember,
  type Role,
} from "@capacitylens/shared/domain/access";
import type { InvitationRole, MembershipStatus } from "@capacitylens/shared/account/types";
import { teamAccessClient, type TeamInvitation, type TeamMember } from "../../account/teamAccessClient";
import { accountClient } from "../../account/accountClient";
import { MAX_EMAIL_LENGTH } from "@capacitylens/shared/lib/strings";
import { isAccountEmail } from "@capacitylens/shared/account/validation";
import { roleLabel, roleSummary } from "../../lib/accessCopy";
import { refreshAccountSummaries } from "../../auth/useAccountSummaries";
import { refreshActiveAccountSlice } from "../../data/persist";
import { offlineStateSnapshot } from "../../data/offlineCache";
import { useOfflineState } from "../../data/useOfflineState";
import { useTeamDirectory } from "./useTeamDirectory";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldSet } from "../ui/field";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";
import { Badge } from "../ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { ChevronDown, ChevronRight, Pencil, Settings } from "lucide-react";
import { APP_NAME } from "@capacitylens/shared/brand";
import { Switch } from "../ui/switch";
import { SsoReadinessPanel } from "./SsoReadinessPanel";
import {
  parseWorkspaceReadiness,
  type ReadinessMember,
  type ReadinessRepairLink,
  type WorkspaceReadiness,
} from "./ssoReadiness";

// Member-management section shown in Team & access on an auth-enabled, server-backed deploy.
// Owner/Admin list members in a table (name / email / optional sign-in confirmation), change a member's role through the
// row's pencil, reach the rarer lifecycle actions through the row's gear, and invite people from a
// SEPARATE card below (#175). Ownership transfer is deliberately absent: it is not a per-row action
// and returns as its own owner-only section under a follow-up ticket. The CLIENT
// gate is courtesy only — the SAME pure guards (canManageMemberRole / canRemoveMember) hide controls
// the user can't use, but the SERVER is the backstop (every route is gated server-side; a 403 on the
// initial members fetch is what hides the whole section for a viewer/editor). The invite TOKEN is
// shown exactly ONCE, straight from the create response — it is write-once and never read back.

type Member = TeamMember;
type MemberConfirmationAction = "remove" | "resetPassword" | "revokeSessions" | "disable" | "archive" | "restore";
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
          ? m.settings_revoke_self_sessions_message({ app: APP_NAME })
          : m.settings_revoke_sessions_message({ member: labelFor(member), app: APP_NAME }),
      };
    case "disable":
      return {
        title: m.settings_disable_member_title(),
        confirmLabel: m.settings_member_disable(),
        message: m.settings_disable_member_message({ member: labelFor(member) }),
      };
    case "archive":
      return {
        title: m.settings_archive_member_title(),
        confirmLabel: m.settings_member_archive(),
        message: m.settings_archive_member_message({ member: labelFor(member) }),
      };
    case "restore":
      return {
        title: m.settings_restore_member_title(),
        confirmLabel: m.settings_member_restore(),
        message: m.settings_restore_member_message({ member: labelFor(member) }),
      };
  }
}

/** The status a confirmed lifecycle action writes. Kept beside confirmationCopy so a new action
 *  cannot be added to the union without deciding both its wording and its effect. */
const STATUS_FOR_ACTION: Readonly<Record<"disable" | "archive" | "restore", MembershipStatus>> = Object.freeze({
  disable: "disabled",
  archive: "archived",
  restore: "active",
});

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

/** One row of the gear popover. A plain button, not a Radix menu item: the popover holds four
 *  actions at most and each one opens a confirmation, so the extra roving-focus machinery of a
 *  full menu would buy nothing. */
function MemberMenuItem({
  label,
  ariaLabel,
  testId,
  danger = false,
  onSelect,
}: {
  label: string;
  ariaLabel: string;
  testId: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      data-testid={testId}
      className={`flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent ${
        danger ? "text-danger" : "text-ink"
      }`}
      onClick={onSelect}
    >
      {label}
    </button>
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
  const { authMode, providers, refreshAuth } = useAuth();
  const strictProvider = providers?.find((provider) => provider.kind === "oidc" && !provider.experimental) ?? null;
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
  const actionStatusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (busyAction !== null) actionStatusRef.current?.focus();
  }, [busyAction]);
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
  useEffect(() => {
    if (gate !== "shown" || !activeAccountId || !strictProvider || offline.readOnly) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await accountClient.getSsoReadiness(activeAccountId);
        const body: unknown = await response.json().catch(() => null);
        const parsed = parseWorkspaceReadiness(body);
        if (!response.ok || !parsed || parsed.provider.id !== strictProvider.id) {
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
  }, [activeAccountId, gate, offline.readOnly, readinessRevision, strictProvider]);
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
      const nextInvites = inviteResult.value;
      replaceDirectory(memberResult.value, nextInvites);
      setReadinessRevision((value) => value + 1);
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
  const mayManageSignInTracking = myRole !== undefined && can(myRole, "manageMemberSignInTracking");
  const changeSignInTracking = async (next: boolean) => {
    const accountId = requestAccountId();
    if (!beginAction("member-sign-in-tracking")) return;
    try {
      const result = await teamAccessClient.setMemberSignInTracking(accountId, next);
      if (!isActiveAccount(accountId)) return;
      if (result.kind !== "ok") {
        fail(
          null,
          result.kind === "rejected" && result.message
            ? result.message
            : m.settings_members_err_sign_in_tracking({ status: result.status }),
        );
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
    } finally {
      endAction();
    }
  };
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
      setReadinessRevision((value) => value + 1);
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
      setReadinessRevision((value) => value + 1);
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

  // Disable / archive / restore a membership. The row survives with its role intact; every
  // authorization read narrows on status='active', so a non-active membership simply confers
  // nothing. `mem` is NOT `m` (the i18n catalogue) — see changeRole above.
  const changeStatus = async (mem: Member, nextStatus: MembershipStatus) => {
    if (nextStatus === mem.status) return;
    const accountId = requestAccountId();
    if (!beginAction(`status:${mem.userId}`)) return;
    try {
      const result = await teamAccessClient.changeMemberStatus(accountId, mem.userId, nextStatus);
      if (!isActiveAccount(accountId)) return;
      if (result.kind !== "ok") {
        if (result.kind === "unknown") {
          await reconcileUnknownMutation(m.settings_members_unknown_status_change());
          return;
        }
        fail(
          null,
          result.kind === "rejected" && result.message
            ? result.message
            : m.settings_members_err_change_status({ status: result.status }),
        );
        return;
      }
      setNotice(m.settings_members_status_changed());
      // setMemberStatus burns this member's outstanding reset tokens server-side, exactly as an
      // ordinary membership write does, so a shown link for them is already dead.
      if (resetLink?.userId === mem.userId) setResetLink(null);
      reload();
      setReadinessRevision((value) => value + 1);
    } catch (e) {
      await reconcileUnknownMutation(
        m.settings_members_error_detail({
          message: m.settings_members_unknown_status_change(),
          error: errorMessage(e),
        }),
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
      // changeRole / changeStatus clears above).
      setResetLink({
        userId: mem.userId,
        link: `${window.location.origin}/reset-password/${encodeURIComponent(body.token)}`,
        member: labelFor(mem),
        expiresAt: body.expiresAt,
      });
      setNotice(m.settings_members_reset_created());
      setReadinessRevision((value) => value + 1);
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
    if (authMode === "sso" && trimmed.length === 0) {
      fail("invite", m.settings_sso_invite_email_required());
      return;
    }
    if (trimmed.length > 0 && !isAccountEmail(trimmed)) {
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
    const accountId = requestAccountId();
    const email = emailRepair.email.trim().toLowerCase();
    if (!isAccountEmail(email)) {
      fail("sso-email", m.identity_err_email());
      return;
    }
    if (!beginAction(`sso-email:${emailRepair.member.principalId}`)) return;
    try {
      const response = await accountClient.correctMemberEmail(accountId, emailRepair.member.principalId, email);
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : m.settings_sso_correct_email_error();
        fail("sso-email", message);
        return;
      }
      const changedSelf = members?.some((member) => member.userId === emailRepair.member.principalId && member.isSelf);
      setEmailRepair(null);
      setNotice(m.settings_sso_correct_email_done());
      if (changedSelf) {
        window.location.reload();
        return;
      }
      reload();
      setReadinessRevision((value) => value + 1);
    } catch (cause) {
      console.error("MembersSection: SSO email correction failed", cause);
      fail("sso-email", m.settings_sso_correct_email_error());
    } finally {
      endAction();
    }
  };

  const removeIncorrectSsoLink = async (member: ReadinessMember, link: ReadinessRepairLink) => {
    const accountId = requestAccountId();
    if (!beginAction(`sso-unlink:${member.principalId}`)) return;
    try {
      const response = await accountClient.removeFederatedLink(accountId, member.principalId, link);
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : m.settings_sso_remove_link_error();
        fail(null, message);
        return;
      }
      const changedSelf = members?.some((candidate) => candidate.userId === member.principalId && candidate.isSelf);
      setNotice(m.settings_sso_remove_link_done());
      if (changedSelf) {
        window.location.reload();
        return;
      }
      setReadinessRevision((value) => value + 1);
    } catch (cause) {
      console.error("MembersSection: SSO link removal failed", cause);
      fail(null, m.settings_sso_remove_link_error());
    } finally {
      endAction();
    }
  };

  const memberConfirmationCopy = memberConfirmation ? confirmationCopy(memberConfirmation) : null;

  // The directory arrives in one list and splits in two for display (#175). The main table is the
  // team — no "active" heading, because those rows are simply the members. Disabled and archived
  // rows move into the collapsed group below; they keep their badge there, so the two states stay
  // distinguishable without a table each. The server's order (join date, then name) is preserved by
  // filtering rather than re-sorting.
  const activeMembers = members?.filter((mem) => mem.status === "active") ?? null;
  const inactiveMembers = members?.filter((mem) => mem.status !== "active") ?? [];

  // One row renderer for both tables: the gear's actions, the pencil's gate and the status badge are
  // identical wherever the row is drawn — only the grouping differs.
  const memberRow = (mem: Member) => {
    // NB: the row var is `mem`, NOT `m` — `m` is the imported i18n message catalogue
    // (P1.5.2); shadowing it would make `m.settings_*()` resolve against the Member.
    // Ordinary role changes never touch the Owner.
    const representativeRole: Role = mem.role === "viewer" ? "editor" : "viewer";
    // The role editor is ACTIVE-only, matching the server: changeMemberRole resolves its target
    // through getActiveMemberRole, so offering the pencil on a non-active row could only ever
    // produce a 404. Restore the member first, then change the role — a role change must not be a
    // back door that quietly reinstates access.
    const mayTouch = mem.status === "active" && !!myRole && canManageMemberRole(myRole, mem.role, representativeRole);
    // Remove, by contrast, is status-agnostic on both sides: deleting a non-active membership is a
    // normal administrative act and must not require reinstating it first.
    const mayRemove = !!myRole && canRemoveMember(myRole, mem.role);
    const mayChangeStatus = !!myRole && canChangeMemberStatus(myRole, mem.role, mem.isSelf);
    const memberLabel = labelFor(mem);
    // Reset links exist only in PASSWORD mode ('sso' delegates credentials to the IdP;
    // the server 400s there regardless) and never for a target an admin can't touch
    // (e.g. an owner, or a member who owns another account — a reset link is an
    // account-takeover capability). We trust the SERVER-computed `mayResetPassword`:
    // it already folds in the cross-account + self-exemption checks the per-account
    // pure guard cannot see AND returns `false` in SSO mode.
    const mayReset = mem.mayResetPassword;
    const hasMenu = mayReset || mem.mayRevokeSessions || mayChangeStatus || mayRemove;
    const name = mem.name?.trim() || mem.userId;
    return (
      <tr key={mem.userId} className="border-b last:border-b-0" data-testid="member-row">
        <td className="py-2 pr-3">
          <div className="flex flex-col items-start gap-1">
            <span className="text-ink">
              {name}
              {mem.isSelf && <span className="ml-1 text-xs text-muted-foreground">{m.settings_member_you()}</span>}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground" data-testid="member-role">
                {mem.role === "owner" ? m.settings_member_sole_owner_protected() : roleLabel(mem.role)}
              </span>
              {mem.status !== "active" && (
                <Badge variant="outline" data-testid="member-status">
                  {mem.status === "disabled"
                    ? m.settings_member_status_disabled()
                    : m.settings_member_status_archived()}
                </Badge>
              )}
            </div>
          </div>
        </td>
        <td className="py-2 pr-3 text-muted-foreground" data-testid="member-email">
          {mem.email ?? m.settings_member_email_missing()}
        </td>
        {signInTrackingEnabled && (
          <td className="py-2 pr-3 text-muted-foreground" data-testid="member-sign-in-confirmed">
            {mem.signInConfirmed ? m.settings_member_sign_in_confirmed() : m.settings_member_sign_in_not_confirmed()}
          </td>
        )}
        <td className="w-10 py-2 pl-8 text-right">
          {mayTouch && (
            <Button
              size="sm"
              variant="ghost"
              title={m.settings_member_edit_aria({ member: memberLabel })}
              aria-label={m.settings_member_edit_aria({ member: memberLabel })}
              data-testid="member-edit"
              disabled={busyAction !== null}
              onClick={() => setRoleEdit({ member: mem, nextRole: mem.role })}
            >
              <Pencil />
            </Button>
          )}
        </td>
        <td className="w-10 py-2 pl-2 text-right">
          {hasMenu && (
            <Popover
              open={openMenuFor === mem.userId}
              onOpenChange={(open) => setOpenMenuFor(open ? mem.userId : null)}
            >
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  title={m.settings_member_settings_aria({ member: memberLabel })}
                  aria-label={m.settings_member_settings_aria({ member: memberLabel })}
                  data-testid="member-menu"
                  disabled={busyAction !== null}
                >
                  <Settings />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-1">
                <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {m.settings_member_settings_heading()}
                </p>
                {mayReset && (
                  <MemberMenuItem
                    testId="member-reset-password"
                    label={m.settings_member_reset_password()}
                    ariaLabel={m.settings_member_reset_password_aria({ member: memberLabel })}
                    onSelect={() => chooseMemberAction("resetPassword", mem)}
                  />
                )}
                {mem.mayRevokeSessions && (
                  <MemberMenuItem
                    testId="member-revoke-sessions"
                    label={m.settings_member_revoke_sessions()}
                    ariaLabel={m.settings_member_revoke_sessions_aria({ member: memberLabel })}
                    onSelect={() => chooseMemberAction("revokeSessions", mem)}
                  />
                )}
                {mayChangeStatus &&
                  (mem.status === "active" ? (
                    <>
                      <MemberMenuItem
                        testId="member-disable"
                        label={m.settings_member_disable()}
                        ariaLabel={m.settings_member_disable_aria({ member: memberLabel })}
                        onSelect={() => chooseMemberAction("disable", mem)}
                      />
                      <MemberMenuItem
                        testId="member-archive"
                        label={m.settings_member_archive()}
                        ariaLabel={m.settings_member_archive_aria({ member: memberLabel })}
                        onSelect={() => chooseMemberAction("archive", mem)}
                      />
                    </>
                  ) : (
                    <MemberMenuItem
                      testId="member-restore"
                      label={m.settings_member_restore()}
                      ariaLabel={m.settings_member_restore_aria({ member: memberLabel })}
                      onSelect={() => chooseMemberAction("restore", mem)}
                    />
                  ))}
                {mayRemove && (
                  <MemberMenuItem
                    testId="member-remove"
                    label={m.settings_member_remove()}
                    ariaLabel={m.settings_member_remove_aria({ member: memberLabel })}
                    danger
                    onSelect={() => chooseMemberAction("remove", mem)}
                  />
                )}
              </PopoverContent>
            </Popover>
          )}
        </td>
      </tr>
    );
  };

  // Wrapped in an overflow container so a narrow viewport scrolls the TABLE, never the page.
  const membersTable = (rows: Member[], testId: string) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid={testId}>
        <thead>
          <tr className="border-b text-left text-xs font-medium text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">
              {m.settings_member_col_name()}
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              {m.settings_member_col_email()}
            </th>
            {signInTrackingEnabled && (
              <th scope="col" className="py-2 pr-3 font-medium">
                {m.settings_member_col_sign_in_confirmed()}
              </th>
            )}
            <th scope="col" className="w-10 py-2 pl-8 text-right font-medium">
              <span className="sr-only">{m.settings_member_col_edit()}</span>
            </th>
            <th scope="col" className="w-10 py-2 pl-2 text-right font-medium">
              <span className="sr-only">{m.settings_member_col_settings()}</span>
            </th>
          </tr>
        </thead>
        <tbody>{rows.map(memberRow)}</tbody>
      </table>
    </div>
  );

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
          <p ref={actionStatusRef} role="status" aria-live="polite" tabIndex={-1} className="sr-only">
            {busyAction ? m.settings_members_updating() : ""}
          </p>
          <FieldError id={errorId}>{errorField === null ? error : null}</FieldError>

          {gate === "shown" && !offline.readOnly && strictProvider && readinessError && (
            <section
              className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/5 p-3"
              data-testid="sso-readiness-error"
              role="alert"
            >
              <h3 className="text-sm font-medium text-danger">{m.settings_sso_readiness_heading()}</h3>
              <p className="text-xs text-danger">{m.settings_sso_readiness_error()}</p>
            </section>
          )}

          {gate === "shown" && !offline.readOnly && strictProvider && readiness && (
            <SsoReadinessPanel
              authMode={authMode}
              readiness={readiness}
              busy={busyAction !== null}
              emailRepair={emailRepair}
              setEmailRepair={setEmailRepair}
              error={error}
              errorField={errorField}
              errorId={errorId}
              onCorrectEmail={() => void correctSsoEmail()}
              onRemoveLink={(member, link) => setUnlinkRepair({ member, link })}
            />
          )}

          {mayManageSignInTracking && (
            <Field orientation="horizontal" data-disabled={busyAction !== null || undefined}>
              <FieldContent>
                <FieldLabel htmlFor="member-sign-in-tracking">{m.settings_members_sign_in_tracking_label()}</FieldLabel>
                <FieldDescription>{m.settings_members_sign_in_tracking_description()}</FieldDescription>
              </FieldContent>
              <Switch
                id="member-sign-in-tracking"
                data-testid="member-sign-in-tracking"
                checked={signInTrackingEnabled}
                disabled={busyAction !== null}
                onCheckedChange={(next) => void changeSignInTracking(next)}
              />
            </Field>
          )}

          {/* The role stays visible beneath the member's name without consuming a column. The
              optional coarse sign-in confirmation contains no date; edit and settings remain two
              separate columns pushed to the right, in that order. */}
          {members && members.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{m.settings_members_empty()}</p>
          ) : (
            activeMembers && membersTable(activeMembers, "members-table")
          )}

          {/* Disabled and archived memberships, collapsed behind a disclosure (#175). They are still
              real rows an administrator has to be able to reach — to restore one, or to remove it —
              but they are not the team, so they do not compete with it for the reader's attention.
              The group is absent entirely when there is nothing in it. */}
          {inactiveMembers.length > 0 && (
            <section className="flex flex-col gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 self-start text-sm font-medium text-brand underline-offset-2 hover:underline"
                aria-expanded={inactiveOpen}
                aria-controls="members-inactive"
                data-testid="members-inactive-toggle"
                onClick={() => setInactiveOpen((open) => !open)}
              >
                {inactiveOpen ? <ChevronDown data-icon="inline-start" /> : <ChevronRight data-icon="inline-start" />}
                {m.settings_members_inactive_group({ count: inactiveMembers.length })}
              </button>
              {inactiveOpen && (
                <div id="members-inactive">{membersTable(inactiveMembers, "members-inactive-table")}</div>
              )}
            </section>
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
        </CardContent>
      </Card>

      {/* Inviting someone is its own job, not a footnote to the member table (#175): it lives in a
          separate card together with the invites that are still outstanding. */}
      {mayManageInvites && (
        <Card data-testid="invites-section" aria-busy={busyAction !== null}>
          <CardHeader>
            <CardTitle>
              <h2>{m.settings_invite_heading()}</h2>
            </CardTitle>
            <CardDescription>{m.settings_invite_intro()}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FieldSet className="gap-2">
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
                    label={
                      authMode === "sso"
                        ? m.settings_invite_preauth_label_required()
                        : m.settings_invite_preauth_label()
                    }
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

            {/* Outstanding invites */}
            {invites.length > 0 && (
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
      )}
      {memberConfirmation && memberConfirmationCopy && (
        <ConfirmDialog
          title={memberConfirmationCopy.title}
          confirmLabel={memberConfirmationCopy.confirmLabel}
          message={memberConfirmationCopy.message}
          onConfirm={confirmedMemberAction}
          onCancel={() => setMemberConfirmation(null)}
        />
      )}
      {/* The pencil's editor. Role only, by design (#175): everything else a member's row can do
          lives behind the gear, and ownership is not a row-level action at all. */}
      {roleEdit && (
        <Modal
          title={m.settings_change_role_title()}
          onClose={() => setRoleEdit(null)}
          onSubmit={() => {
            const pending = roleEdit;
            setRoleEdit(null);
            void changeRole(pending.member, pending.nextRole);
          }}
          footer={
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => setRoleEdit(null)}>
                {m.form_cancel()}
              </Button>
              <Button type="submit" size="sm" data-testid="member-role-save" disabled={busyAction !== null}>
                {m.settings_member_role_save()}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">{labelFor(roleEdit.member)}</p>
          <span data-testid="member-role-select">
            <SelectField
              label={m.settings_member_role_label()}
              ariaLabel={m.settings_member_role_aria({ member: labelFor(roleEdit.member) })}
              value={roleEdit.nextRole}
              onChange={(value) =>
                setRoleEdit((current) => (current ? { ...current, nextRole: value as Role } : current))
              }
              options={roleOptions()}
              disabled={busyAction !== null}
            />
          </span>
          <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="member-role-summary">
            {roleSummary(roleEdit.nextRole)}
          </p>
        </Modal>
      )}
      {unlinkRepair && (
        <ConfirmDialog
          title={m.settings_sso_remove_link_title()}
          confirmLabel={m.settings_sso_remove_link()}
          message={m.settings_sso_remove_link_message({
            member: unlinkRepair.member.email ?? unlinkRepair.member.displayName ?? unlinkRepair.member.principalId,
          })}
          onConfirm={() => {
            const pending = unlinkRepair;
            setUnlinkRepair(null);
            void removeIncorrectSsoLink(pending.member, pending.link);
          }}
          onCancel={() => setUnlinkRepair(null)}
        />
      )}
    </>
  );
}
