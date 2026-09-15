import { useCallback, useEffect, useRef, useState } from "react";
import { m } from "@/i18n";
import type { Role } from "@capacitylens/shared/domain/access";
import type { TeamInvitation, TeamMember as Member } from "../../account/teamAccessClient";
import { resolveStrictOidcProvider, useAuth } from "../../auth/authContext";
import { isServerConfigured } from "../../data/apiConfig";
import { useOfflineState } from "../../data/useOfflineState";
import { useNavigatorOnline } from "../../data/useNavigatorOnline";
import { useDeadlineClock } from "../../hooks/useDeadlineClock";
import { useFieldError } from "../../hooks/useFieldError";
import { useStore } from "../../store/useStore";
import type { StoreState } from "../../store/types";
import { useTeamDirectory } from "./useTeamDirectory";
import { useMemberInvites, type InvitationPersonOption } from "./useMemberInvites";
import { useWorkspaceReadiness } from "./useWorkspaceReadiness";
import { createMemberAccessReconciliation } from "./createMemberAccessReconciliation";
import { createMemberMutations } from "./createMemberMutations";
import { startMasquerade } from "../../auth/accountTransition";
import { STATUS_FOR_ACTION, type MemberConfirmation, type MemberConfirmationAction } from "./memberConfirmationCopy";
import { buildMemberDirectoryPresentation } from "./buildMemberDirectoryPresentation";
import type { WorkspaceReadiness } from "./ssoReadiness";
import { resolveInvitationDirectoryBoundary } from "./useMemberInvitationState";
import { useInvitationResourceHandoff } from "./useInvitationResourceHandoff";

const NO_INVITES: readonly TeamInvitation[] = Object.freeze([]);

function selectAuthorizedDirectory(directory: ReturnType<typeof useTeamDirectory>["directory"]) {
  switch (directory.kind) {
    case "ready":
      return directory.snapshot;
    case "error":
      return directory.content.kind === "authorized" ? directory.content.snapshot : null;
    case "hidden":
    case "loading":
      return null;
  }
}

function assertNeverReadinessState(state: never): never {
  throw new Error(`Unexpected workspace readiness state: ${JSON.stringify(state)}`);
}

function resolveReadinessPresentation(state: ReturnType<typeof useWorkspaceReadiness>["readinessState"]): {
  readiness: WorkspaceReadiness | null;
  readinessError: boolean;
} {
  switch (state.kind) {
    case "loading":
      return { readiness: null, readinessError: false };
    case "ready":
      return { readiness: state.readiness, readinessError: false };
    case "error":
      return { readiness: null, readinessError: true };
  }
  return assertNeverReadinessState(state);
}

function pickNextInviteDeadline(invites: readonly TeamInvitation[], clock: number): number | null {
  const nextExpiry = invites
    .filter((invite) => invite.usedAt === null)
    .map((invite) => Date.parse(invite.expiresAt))
    .filter((expiry) => Number.isFinite(expiry) && expiry > clock)
    .reduce((nearest, expiry) => Math.min(nearest, expiry), Number.POSITIVE_INFINITY);
  return Number.isFinite(nextExpiry) ? nextExpiry : null;
}

function useMemberViewState() {
  const [resetLink, setResetLink] = useState<{
    userId: string;
    link: string;
    member: string;
    expiresAt: string;
  } | null>(null);
  const [roleEdit, setRoleEdit] = useState<{ member: Member; nextRole: Role } | null>(null);
  const [memberConfirmation, setMemberConfirmation] = useState<MemberConfirmation | null>(null);
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [inactiveOpen, setInactiveOpen] = useState(false);
  return {
    resetLink,
    setResetLink,
    roleEdit,
    setRoleEdit,
    memberConfirmation,
    setMemberConfirmation,
    openMenuFor,
    setOpenMenuFor,
    inactiveOpen,
    setInactiveOpen,
  };
}

function useActionStatusFocus(busyAction: string | null) {
  const actionStatusRef = useRef<HTMLParagraphElement>(null);
  const setActionStatusElement = useCallback((element: HTMLParagraphElement | null) => {
    actionStatusRef.current = element;
  }, []);
  useEffect(() => {
    if (busyAction !== null) actionStatusRef.current?.focus();
  }, [busyAction]);
  return setActionStatusElement;
}

function createConfirmationActions(
  activeAccountId: string | null,
  state: ReturnType<typeof useMemberViewState>,
  actions: ReturnType<typeof createMemberMutations>,
) {
  const chooseMemberAction = (action: MemberConfirmationAction, member: Member) => {
    state.setOpenMenuFor(null);
    state.setMemberConfirmation({ kind: action, member });
  };
  const confirmMemberAction = () => {
    if (!state.memberConfirmation) return;
    const pending = state.memberConfirmation;
    state.setMemberConfirmation(null);
    switch (pending.kind) {
      case "masquerade":
        if (activeAccountId) void startMasquerade(activeAccountId, pending.member.userId);
        return;
      case "remove":
        void actions.removeMember(pending.member);
        return;
      case "resetPassword":
        void actions.resetPassword(pending.member);
        return;
      case "revokeSessions":
        void actions.revokeSessions(pending.member);
        return;
      case "disable":
      case "archive":
      case "restore":
        void actions.changeStatus(pending.member, STATUS_FOR_ACTION[pending.kind]);
        return;
    }
  };
  return { chooseMemberAction, confirmMemberAction };
}

interface MemberDirectoryStateInput {
  activeAccountId: string | null;
  enabled: boolean;
  offlineReadOnly: boolean;
  fail: ReturnType<typeof useFieldError>["fail"];
  setNotice: StoreState["setNotice"];
  setActiveAccount: StoreState["setActiveAccount"];
  viewState: ReturnType<typeof useMemberViewState>;
  reconcileMintedInvite: ReturnType<typeof useMemberInvites>["reconcileMintedInvite"];
}

function useMemberDirectoryState(input: MemberDirectoryStateInput) {
  const directoryState = useTeamDirectory({
    enabled: input.enabled,
    activeAccountId: input.activeAccountId,
    offlineReadOnly: input.offlineReadOnly,
    fail: input.fail,
    onInvitesLoaded: input.reconcileMintedInvite,
  });
  const authorizedDirectory = selectAuthorizedDirectory(directoryState.directory);
  const members = authorizedDirectory?.members ?? null;
  const invites = authorizedDirectory?.invites ?? NO_INVITES;
  const resourceCandidates = authorizedDirectory?.resourceCandidates ?? [];
  const requestAccountId = (): string => {
    if (!input.activeAccountId) throw new Error(m.settings_members_err_no_active_account());
    return input.activeAccountId;
  };
  const isActiveAccount = (accountId: string): boolean => useStore.getState().activeAccountId === accountId;
  const closeActiveAccount = (): void => {
    if (useStore.getState().activeAccountId !== input.activeAccountId) return;
    input.setActiveAccount(null);
    useStore.setState({ previousAccountId: null });
  };
  const withMemberAction = async (key: string, body: (accountId: string) => Promise<void>): Promise<void> => {
    const accountId = requestAccountId();
    if (!directoryState.beginAction(key)) return;
    try {
      await body(accountId);
    } finally {
      directoryState.endAction();
    }
  };
  const clearResetLinkFor = (userId: string): void => {
    if (input.viewState.resetLink?.userId === userId) input.viewState.setResetLink(null);
  };
  const renderedAt = useDeadlineClock({
    pickNextDeadline: (clock) => pickNextInviteDeadline(invites, clock),
    readNow: Date.now,
  });
  return {
    ...directoryState,
    members,
    resourceCandidates,
    renderedAt,
    closeActiveAccount,
    clearResetLinkFor,
    actionDependencies: {
      requestAccountId,
      isActiveAccount,
      withMemberAction,
      fail: input.fail,
      setNotice: input.setNotice,
    },
  };
}

interface MemberMutationStateInput {
  activeAccountId: string | null;
  authMode: ReturnType<typeof useAuth>["authMode"];
  strictProviderId: string | null;
  offlineReadOnly: boolean;
  refreshAuth: ReturnType<typeof useAuth>["refreshAuth"];
  invalidateMemberships: StoreState["invalidateMemberships"];
  clear: ReturnType<typeof useFieldError>["clear"];
  viewState: ReturnType<typeof useMemberViewState>;
  inviteState: ReturnType<typeof useMemberInvites>;
  createInviteActions: ReturnType<typeof useMemberInvites>["createActions"];
  directoryState: ReturnType<typeof useMemberDirectoryState>;
  invitationPeople: readonly InvitationPersonOption[];
}

function useMemberMutationState(input: MemberMutationStateInput) {
  const refreshDirectory = () => {
    input.directoryState.reload();
    bumpReadiness();
  };
  const { bumpReadiness, readinessState, ...readinessActions } = useWorkspaceReadiness({
    activeAccountId: input.activeAccountId,
    strictProviderId: input.strictProviderId,
    directory: input.directoryState.directory,
    offlineReadOnly: input.offlineReadOnly,
    members: input.directoryState.members,
    refreshDirectory,
    ...input.directoryState.actionDependencies,
  });
  const reconciliation = createMemberAccessReconciliation({
    activeAccountId: input.activeAccountId,
    invalidateMemberships: input.invalidateMemberships,
    refreshAuth: input.refreshAuth,
    closeActiveAccount: input.directoryState.closeActiveAccount,
    ...input.directoryState.actionDependencies,
    bumpReadiness,
    replaceAuthorizedDirectory: input.directoryState.replaceAuthorizedDirectory,
    reconcileMintedInvite: input.inviteState.reconcileMintedInvite,
  });
  const actions = createMemberMutations({
    ...input.directoryState.actionDependencies,
    ...reconciliation,
    refreshDirectory,
    reload: input.directoryState.reload,
    clearResetLinkFor: input.directoryState.clearResetLinkFor,
    setResetLink: input.viewState.setResetLink,
    bumpReadiness,
  });
  const inviteActions = input.createInviteActions({
    authMode: input.authMode,
    clear: input.clear,
    ...input.directoryState.actionDependencies,
    reloadInvites: input.directoryState.reloadInvites,
    reconcileUnknownMutation: reconciliation.reconcileUnknownMutation,
    invitationPeople: input.invitationPeople,
  });
  return {
    actions,
    inviteActions,
    readinessActions,
    readinessPresentation: resolveReadinessPresentation(readinessState),
    confirmationActions: createConfirmationActions(input.activeAccountId, input.viewState, actions),
  };
}

function selectPublicViewState(viewState: ReturnType<typeof useMemberViewState>) {
  return {
    roleEdit: viewState.roleEdit,
    setRoleEdit: viewState.setRoleEdit,
    memberConfirmation: viewState.memberConfirmation,
    setMemberConfirmation: viewState.setMemberConfirmation,
    openMenuFor: viewState.openMenuFor,
    setOpenMenuFor: viewState.setOpenMenuFor,
    inactiveOpen: viewState.inactiveOpen,
    setInactiveOpen: viewState.setInactiveOpen,
  };
}

function useMemberStoreActions() {
  return {
    setNotice: useStore((state) => state.setNotice),
    setActiveAccount: useStore((state) => state.setActiveAccount),
    invalidateMemberships: useStore((state) => state.invalidateMemberships),
  };
}

// eslint-disable-next-line max-lines-per-function
export function useMembersOrchestration(activeAccountId: string | null) {
  const { authMode, providers, refreshAuth, sessionGeneration = 0, user } = useAuth();
  // Only the strict (non-experimental) OIDC provider's IDENTITY is needed here: the readiness read
  // is keyed on it, and keying on the provider OBJECT would re-fetch whenever an equal-but-new
  // provider list is resolved.
  const strictProviderId = resolveStrictOidcProvider(providers)?.id ?? null;
  const offline = useOfflineState();
  const online = useNavigatorOnline();
  const { setNotice, setActiveAccount, invalidateMemberships } = useMemberStoreActions();
  const { error, errorField, errorId, fail, clear } = useFieldError();
  const viewState = useMemberViewState();
  const enabled = authMode !== "off" && isServerConfigured();
  const inviteContextKey = [
    activeAccountId ?? "",
    user?.id ?? "",
    sessionGeneration,
    authMode,
    enabled ? "configured" : "unconfigured",
    offline.readOnly ? "offline" : "online",
    online ? "browser-online" : "browser-offline",
    "team-boundary",
  ].join("\u0000");
  const memberInvites = useMemberInvites(null, inviteContextKey);
  const directoryState = useMemberDirectoryState({
    activeAccountId,
    enabled,
    offlineReadOnly: offline.readOnly,
    fail,
    setNotice,
    setActiveAccount,
    viewState,
    reconcileMintedInvite: memberInvites.reconcileMintedInvite,
  });
  const directoryBoundary = resolveInvitationDirectoryBoundary(directoryState);
  const setInvitationResourceId = memberInvites.setInvitationResourceId;
  const proposedResourceId = useInvitationResourceHandoff({
    activeAccountId,
    authMode,
    directoryAuthorized: directoryBoundary.authorized,
    directoryPending: directoryState.directory.kind === "loading",
    enabled,
    offlineReadOnly: offline.readOnly,
    online,
    resetInviteDraft: memberInvites.resetInviteDraft,
    sessionGeneration,
    user,
  });
  useEffect(() => {
    if (proposedResourceId !== null) setInvitationResourceId(proposedResourceId);
  }, [proposedResourceId, setInvitationResourceId]);
  const { createActions: createInviteActions, ...inviteState } = memberInvites;
  const resourceCandidates = directoryState.resourceCandidates;
  const linkedResourceIds = new Set(
    (directoryState.members ?? []).flatMap((member) => (member.resourceLink ? [member.resourceLink.resourceId] : [])),
  );
  const invitationPeople: InvitationPersonOption[] = resourceCandidates
    .filter(({ resourceId }) => !linkedResourceIds.has(resourceId))
    .map(({ resourceId, label }) => ({ id: resourceId, label }));
  const mutationState = useMemberMutationState({
    activeAccountId,
    authMode,
    strictProviderId,
    offlineReadOnly: offline.readOnly,
    invalidateMemberships,
    refreshAuth,
    clear,
    viewState,
    inviteState: memberInvites,
    createInviteActions,
    directoryState,
    invitationPeople,
  });
  const setActionStatusElement = useActionStatusFocus(directoryState.busyAction);
  return {
    activeAccountId,
    authMode,
    enabled,
    directory: directoryState.directory,
    error,
    errorField,
    errorId,
    clear,
    reload: directoryState.reload,
    ...mutationState.readinessActions,
    ...mutationState.readinessPresentation,
    members: directoryState.members,
    resourceCandidates,
    ...buildMemberDirectoryPresentation(directoryState.members),
    changeSignInTracking: mutationState.actions.changeSignInTracking,
    busyAction: directoryState.busyAction,
    resetLink: viewState.resetLink,
    ...inviteState,
    invitationPeople,
    ...mutationState.inviteActions,
    renderedAt: directoryState.renderedAt,
    ...selectPublicViewState(viewState),
    setActionStatusElement,
    chooseMemberAction: mutationState.confirmationActions.chooseMemberAction,
    confirmedMemberAction: mutationState.confirmationActions.confirmMemberAction,
    changeRole: mutationState.actions.changeRole,
  };
}
