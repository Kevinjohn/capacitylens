import { useCallback, useEffect, useRef, useState } from "react";
import { m } from "@/i18n";
import type { Role } from "@capacitylens/shared/domain/access";
import type { TeamMember as Member } from "../../account/teamAccessClient";
import { strictOidcProvider, useAuth } from "../../auth/authContext";
import { isServerConfigured } from "../../data/apiConfig";
import { useOfflineState } from "../../data/useOfflineState";
import { useDeadlineClock } from "../../hooks/useDeadlineClock";
import { useFieldError } from "../../hooks/useFieldError";
import { useStore } from "../../store/useStore";
import { useTeamDirectory } from "./useTeamDirectory";
import { useMemberInvites } from "./useMemberInvites";
import { useWorkspaceReadiness } from "./useWorkspaceReadiness";
import { memberAccessReconciliation } from "./memberAccessReconciliation";
import { memberMutations } from "./memberMutations";
import { startMasquerade } from "../../auth/accountTransition";
import { STATUS_FOR_ACTION, type MemberConfirmation, type MemberConfirmationAction } from "./memberConfirmationCopy";
import { memberDirectoryPresentation } from "./memberDirectoryPresentation";

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
  const { reconcileMintedInvite, createActions, ...inviteState } = useMemberInvites();
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

  const actionStatusRef = useRef<HTMLParagraphElement>(null);
  const setActionStatusElement = useCallback((element: HTMLParagraphElement | null) => {
    actionStatusRef.current = element;
  }, []);
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
  const actionDependencies = { requestAccountId, isActiveAccount, withMemberAction, fail, setNotice };
  const { bumpReadiness, ...readinessState } = useWorkspaceReadiness({
    activeAccountId,
    strictProviderId,
    gate,
    offlineReadOnly: offline.readOnly,
    members,
    refreshDirectory: () => refreshDirectory(),
    ...actionDependencies,
  });
  /** The pair nearly every membership write needs: re-read the directory, then the readiness that is
   *  derived from it. */
  const refreshDirectory = () => {
    reload();
    bumpReadiness();
  };
  const { refreshCallerAccess, reconcileUnknownMutation } = memberAccessReconciliation({
    activeAccountId,
    invalidateMemberships,
    refreshAuth,
    closeActiveAccount,
    ...actionDependencies,
    bumpReadiness,
    replaceDirectory,
    reconcileMintedInvite,
  });
  const actions = memberMutations({
    ...actionDependencies,
    reconcileUnknownMutation,
    refreshCallerAccess,
    refreshDirectory,
    reload,
    clearResetLinkFor,
    setResetLink,
    bumpReadiness,
  });
  const inviteActions = createActions({
    authMode,
    clear,
    ...actionDependencies,
    reloadInvites,
    reconcileUnknownMutation,
  });
  const { removeMember, resetPassword, revokeSessions, changeStatus } = actions;
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

  const presentation = memberDirectoryPresentation(members);

  return {
    authMode,
    enabled,
    gate,
    error,
    errorField,
    errorId,
    clear,
    reload,
    ...readinessState,
    members,
    ...presentation,
    signInTrackingEnabled,
    changeSignInTracking: actions.changeSignInTracking,
    busyAction,
    resetLink,
    ...inviteState,
    ...inviteActions,
    invites,
    renderedAt,
    roleEdit,
    setRoleEdit,
    memberConfirmation,
    setMemberConfirmation,
    openMenuFor,
    setOpenMenuFor,
    inactiveOpen,
    setInactiveOpen,
    setActionStatusElement,
    chooseMemberAction,
    confirmedMemberAction,
    changeRole: actions.changeRole,
  };
}
