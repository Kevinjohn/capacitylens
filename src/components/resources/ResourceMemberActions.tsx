/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useRef, useState } from "react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import type { Resource } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { useAuth } from "../../auth/authContext";
import { isServerConfigured } from "../../data/apiConfig";
import { useOfflineState } from "../../data/useOfflineState";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { resolveRejectionMessage, teamAccessClient, type TeamMember } from "../../account/teamAccessClient";
import { useStore } from "../../store/useStore";
import { Button } from "../ui/button";
import { LinkResourceDialog } from "./ResourceMemberActionDialogs";
import { RemoveResourceMemberLinkButton } from "./RemoveResourceMemberLinkButton";
import { useMemberResourceLinkMutation } from "../settings/useMemberResourceLinkMutation";
import { setInvitationPreselection } from "../settings/invitationPreselection";
import { useNavigatorOnline } from "../../data/useNavigatorOnline";

export type ResourceMemberActionsModel = {
  canManage: boolean;
  authMode: ReturnType<typeof useAuth>["authMode"];
  userId?: string | null;
  sessionIdentity: ReturnType<typeof useAuth>["user"];
  offlineReadOnly: boolean;
  online: boolean;
  members: readonly TeamMember[];
  reload(): void;
  invalidate(): void;
  directoryError: string | null;
  contextKey: string;
};

/** Loads the separately-authorized team projection used by active Resource rows. */
/* eslint-disable react-refresh/only-export-components, complexity, max-lines-per-function */
export function useResourceMemberActionsModel(accountId: string | null): ResourceMemberActionsModel {
  const { authMode, user } = useAuth();
  const offline = useOfflineState();
  const online = useNavigatorOnline();
  const enabled = authMode !== "off" && isServerConfigured();
  const membershipRevision = useStore((state) => state.membershipRevision);
  const accountSummary = useStore((state) => state.accountSummaries.find((summary) => summary.id === accountId));
  const resolvedCanManage =
    accountSummary?.roleStatus !== "unavailable" &&
    (accountSummary?.role === "owner" || accountSummary?.role === "admin");
  const [directory, setDirectory] = useState<{
    accountId: string;
    userId: string;
    members: TeamMember[];
  } | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [forbiddenContext, setForbiddenContext] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const authorizationContextKey = `${accountId ?? ""}\u0000${user?.id ?? ""}\u0000${authMode}\u0000${offline.readOnly}\u0000${online}`;
  const directoryKey = `${authorizationContextKey}\u0000${membershipRevision}\u0000${accountSummary?.role ?? ""}\u0000${accountSummary?.roleStatus ?? ""}`;
  useEffect(() => {
    const generation = ++requestGeneration.current;
    const current = () => requestGeneration.current === generation;
    if (forbiddenContext === authorizationContextKey) return;
    setDirectory(null);
    setDirectoryError(null);
    if (!enabled || !resolvedCanManage || !accountId || !user || offline.readOnly || !online) return;
    void teamAccessClient
      .listMembers(accountId)
      .then((result) => {
        if (!current()) return;
        if (result.kind !== "ok") {
          if (result.kind === "rejected" && result.status === 403) {
            const message = m.settings_members_err_access_changed();
            setForbiddenContext(authorizationContextKey);
            setDirectoryError(message);
            useStore.getState().invalidateMemberships();
            useStore.getState().setNotice(message, "error");
            return;
          }
          setDirectoryError(resolveRejectionMessage(result, m.settings_resource_member_unavailable()));
          return;
        }
        setForbiddenContext(null);
        setDirectory({ accountId, userId: user.id, members: result.value.members });
      })
      .catch((cause: unknown) => {
        if (current()) setDirectoryError(`${m.settings_resource_member_unavailable()} ${resolveErrorMessage(cause)}`);
      });
    return () => {
      requestGeneration.current += 1;
    };
  }, [
    accountId,
    authMode,
    authorizationContextKey,
    directoryKey,
    enabled,
    membershipRevision,
    offline.readOnly,
    online,
    reloadKey,
    resolvedCanManage,
    user,
    forbiddenContext,
  ]);
  const members = directory?.accountId === accountId && directory.userId === user?.id ? directory.members : [];
  const self = members.find((member) => member.isSelf);
  const reload = () => {
    requestGeneration.current += 1;
    setDirectory(null);
    setDirectoryError(null);
    setForbiddenContext(null);
    setReloadKey((value) => value + 1);
    // The Team projection and validated avatar projection share this revision boundary.
    useStore.getState().invalidateMemberships();
  };
  const invalidate = () => {
    requestGeneration.current += 1;
    setDirectory(null);
    setDirectoryError(m.settings_members_err_access_changed());
    setForbiddenContext(authorizationContextKey);
  };
  return {
    members,
    authMode,
    sessionIdentity: user,
    offlineReadOnly: offline.readOnly,
    online,
    userId: user?.id ?? null,
    reload,
    invalidate,
    directoryError,
    contextKey: directoryKey,
    canManage:
      enabled &&
      online &&
      !offline.readOnly &&
      resolvedCanManage &&
      user !== null &&
      accountId !== null &&
      directory !== null &&
      directoryError === null &&
      self?.status === "active" &&
      (self.role === "owner" || self.role === "admin"),
  };
}
/* eslint-enable react-refresh/only-export-components, complexity */

type ResourceMemberActionsProps = {
  resource: Resource;
  accountId: string | null;
  model: ResourceMemberActionsModel;
};

type DialogState = { kind: "link"; resource: Resource } | null;

export function ResourceMemberActions(props: ResourceMemberActionsProps) {
  return useInRouterContext() ? (
    <ResourceMemberActionsInRouter {...props} />
  ) : (
    <ResourceMemberActionsImpl {...props} navigate={(path) => window.history.pushState({}, "", path)} />
  );
}

function ResourceMemberActionsInRouter(props: ResourceMemberActionsProps) {
  const navigate = useNavigate();
  return (
    <ResourceMemberActionsImpl
      {...props}
      navigate={(path) => {
        void navigate(path);
      }}
    />
  );
}

// eslint-disable-next-line complexity
function ResourceMemberActionsImpl({
  resource,
  accountId,
  model,
  navigate,
}: ResourceMemberActionsProps & { navigate(path: string): void }) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const linkedMember = model.members.find((candidate) => candidate.resourceLink?.resourceId === resource.id);
  const mutation = useMemberResourceLinkMutation({
    workspaceId: accountId,
    contextKey: `${model.contextKey}:${resource.id}:${linkedMember?.userId ?? ""}`,
    reload: model.reload,
    onForbidden: (message) => {
      setForbidden(true);
      setDialog(null);
      setError(message);
      model.invalidate();
    },
  });

  useEffect(() => {
    // Pending state belongs to the account/session context too; never leave an old command
    // disabling controls after a tenant, auth or offline transition.
    // Account/auth/offline transitions must discard any private selection or token immediately.
    if (!model.canManage) {
      setDialog(null);
      setError(null);
      setNotice(null);
    }
    // A rejected mutation invalidates this local capability until the next authoritative directory read.
    if (model.canManage) setForbidden(false);
  }, [accountId, model.canManage, model.contextKey]);

  useEffect(() => {
    if (!dialog && notice) noticeRef.current?.focus();
  }, [dialog, notice]);

  if (resource.kind !== "person" || resource.archivedAt || resource.deletedAt || !model.canManage) return null;

  if (forbidden)
    return error ? (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    ) : null;

  const open = (kind: "link" | "invite") => {
    setError(null);
    setNotice(null);
    if (kind === "invite") {
      if (accountId && model.userId && model.sessionIdentity) {
        setInvitationPreselection(
          {
            accountId,
            userId: model.userId,
            sessionIdentity: model.sessionIdentity,
            authMode: model.authMode,
            offlineReadOnly: model.offlineReadOnly,
            online: model.online,
          },
          resource.id,
        );
      }
      void navigate("/team");
      return;
    }
    setDialog({ kind: "link", resource });
  };

  const close = () => {
    setDialog(null);
    setError(null);
  };

  const action = (label: string, onClick: () => void, danger = false) => (
    <Button
      type="button"
      size="sm"
      variant={danger ? "danger-soft" : "outline"}
      aria-label={`${label} ${resource.name ?? resource.role}`}
      onClick={(event) => {
        returnFocusRef.current = event.currentTarget;
        onClick();
      }}
      disabled={mutation.pending}
    >
      {label}
    </Button>
  );

  return (
    <>
      <div className="flex flex-wrap gap-1" data-testid="resource-member-actions">
        {linkedMember ? (
          <>
            {linkedMember.status === "active" && action(m.settings_resource_member_change_link(), () => open("link"))}
            <RemoveResourceMemberLinkButton
              resource={resource}
              member={linkedMember}
              mutation={mutation}
              returnFocusRef={returnFocusRef}
              onSuccess={() => {
                const message = m.settings_resource_member_unlinked();
                setNotice(message);
                useStore.getState().setNotice(message);
              }}
            />
          </>
        ) : (
          <>
            {action(m.settings_resource_member_link_existing(), () => open("link"))}
            {action(m.settings_resource_member_invite(), () => open("invite"))}
          </>
        )}
      </div>
      {dialog?.kind === "link" && (
        <LinkResourceDialog
          resource={dialog.resource}
          accountId={accountId}
          members={model.members}
          mutation={mutation}
          linkedMember={linkedMember}
          pending={mutation.pending}
          error={mutation.error ?? error}
          onError={(value) => {
            mutation.setError(value);
            setError(value);
          }}
          onSuccess={() => {
            setNotice(m.settings_resource_member_linked());
            useStore.getState().setNotice(m.settings_resource_member_linked());
            close();
          }}
          onClose={close}
        />
      )}
      {(error ?? mutation.error) && !dialog && (
        <p role="alert" className="text-sm text-danger">
          {error ?? mutation.error}
        </p>
      )}
      {notice && !dialog && (
        <p ref={noticeRef} tabIndex={-1} role="status" aria-live="polite" className="text-sm text-ok">
          {notice}
        </p>
      )}
    </>
  );
}
