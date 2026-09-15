import { useEffect, useRef, useState } from "react";
import type { Resource } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { useAuth } from "../../auth/authContext";
import { isServerConfigured } from "../../data/apiConfig";
import { useOfflineState } from "../../data/useOfflineState";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { invalidateResourceAvatars } from "../../account/useResourceAvatars";
import { resolveRejectionMessage, teamAccessClient, type TeamMember } from "../../account/teamAccessClient";
import { createMemberResourceCommandController } from "../../account/memberResourceCommandController";
import { useStore } from "../../store/useStore";
import { Button } from "../ui/button";
import { InviteResourceDialog, LinkResourceDialog } from "./ResourceMemberActionDialogs";
import { RemoveResourceMemberLinkButton } from "./RemoveResourceMemberLinkButton";

export type ResourceMemberActionsModel = {
  canManage: boolean;
  authMode: ReturnType<typeof useAuth>["authMode"];
  members: readonly TeamMember[];
  reload(): void;
  reconcileInvitations(): Promise<boolean>;
  directoryError: string | null;
  contextKey: string;
};

function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Loads the separately-authorized team projection used by active Resource rows. */
/* eslint-disable react-refresh/only-export-components, complexity, max-lines-per-function */
export function useResourceMemberActionsModel(accountId: string | null): ResourceMemberActionsModel {
  const { authMode, user } = useAuth();
  const offline = useOfflineState();
  const online = useOnline();
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
  const requestGeneration = useRef(0);
  const directoryKey = `${accountId ?? ""}\u0000${user?.id ?? ""}\u0000${authMode}\u0000${offline.readOnly}\u0000${membershipRevision}\u0000${accountSummary?.role ?? ""}\u0000${accountSummary?.roleStatus ?? ""}`;
  useEffect(() => {
    const generation = ++requestGeneration.current;
    const current = () => requestGeneration.current === generation;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDirectory(null);
    setDirectoryError(null);
    if (!enabled || !resolvedCanManage || !accountId || !user || offline.readOnly || !online) return;
    void teamAccessClient
      .listMembers(accountId)
      .then((result) => {
        if (!current()) return;
        if (result.kind !== "ok") {
          if (result.kind === "rejected" && result.status === 403) return;
          setDirectoryError(resolveRejectionMessage(result, m.settings_resource_member_unavailable()));
          return;
        }
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
    directoryKey,
    enabled,
    membershipRevision,
    offline.readOnly,
    online,
    reloadKey,
    resolvedCanManage,
    user,
  ]);
  const members = directory?.accountId === accountId && directory.userId === user?.id ? directory.members : [];
  const self = members.find((member) => member.isSelf);
  const reload = () => {
    requestGeneration.current += 1;
    setDirectory(null);
    setDirectoryError(null);
    setReloadKey((value) => value + 1);
    // The Team projection and validated avatar projection share this revision boundary.
    useStore.getState().invalidateMemberships();
  };
  const reconcileInvitations = async (): Promise<boolean> => {
    if (!enabled || !resolvedCanManage || !accountId || !user || offline.readOnly || !online) return false;
    const generation = requestGeneration.current;
    let result: Awaited<ReturnType<typeof teamAccessClient.listInvitations>>;
    try {
      result = await teamAccessClient.listInvitations(accountId);
    } catch {
      return false;
    }
    if (requestGeneration.current !== generation) return false;
    if (result.kind === "ok") return true;
    if (result.kind === "rejected" && result.status === 403) reload();
    return false;
  };
  return {
    members,
    authMode,
    reload,
    reconcileInvitations,
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

type DialogState = { kind: "link" | "invite"; resource: Resource } | null;

// eslint-disable-next-line complexity
export function ResourceMemberActions({ resource, accountId, model }: ResourceMemberActionsProps) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [commandController] = useState(createMemberResourceCommandController);
  const linkedMember = model.members.find((candidate) => candidate.resourceLink?.resourceId === resource.id);

  useEffect(() => {
    commandController.invalidate();
    // Pending state belongs to the account/session context too; never leave an old command
    // disabling controls after a tenant, auth or offline transition.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending(false);
    // Account/auth/offline transitions must discard any private selection or token immediately.
    if (!model.canManage) {
      setDialog(null);
      setError(null);
      setInviteLink(null);
      setNotice(null);
    }
    // A rejected mutation invalidates this local capability until the next authoritative directory read.
    if (model.canManage) setForbidden(false);
  }, [accountId, commandController, model.canManage, model.contextKey]);

  useEffect(() => {
    if (!dialog && notice) noticeRef.current?.focus();
  }, [dialog, notice]);

  if (resource.kind !== "person" || resource.archivedAt || resource.deletedAt || !model.canManage || forbidden)
    return null;

  const open = (kind: "link" | "invite") => {
    setError(null);
    setInviteLink(null);
    setNotice(null);
    setDialog({ kind, resource });
  };

  const close = () => {
    setDialog(null);
    setError(null);
    setInviteLink(null);
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
      disabled={pending}
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
              accountId={accountId}
              member={linkedMember}
              pending={pending}
              commandController={commandController}
              setPending={setPending}
              setError={setError}
              reload={model.reload}
              returnFocusRef={returnFocusRef}
              onSuccess={() => {
                const message = m.settings_resource_member_unlinked();
                setNotice(message);
                useStore.getState().setNotice(message);
              }}
              onForbidden={() => {
                setForbidden(true);
                setDialog(null);
                setError(null);
                model.reload();
              }}
              onReconcile={() => {
                const message = m.settings_resource_member_unknown();
                useStore.getState().setNotice(message, "error");
                model.reload();
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
          commandController={commandController}
          linkedMember={linkedMember}
          pending={pending}
          error={error}
          onError={setError}
          onPending={setPending}
          onForbidden={() => {
            setForbidden(true);
            close();
            model.reload();
          }}
          onReconcile={() => {
            const message = m.settings_resource_member_unknown();
            useStore.getState().setNotice(message, "error");
            model.reload();
          }}
          onSuccess={() => {
            const message = m.settings_resource_member_linked();
            setNotice(message);
            useStore.getState().setNotice(message);
            invalidateResourceAvatars();
            model.reload();
            close();
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "invite" && (
        <InviteResourceDialog
          resource={dialog.resource}
          accountId={accountId}
          authMode={model.authMode}
          pending={pending}
          error={error}
          inviteLink={inviteLink}
          onError={setError}
          onPending={setPending}
          onForbidden={() => {
            setForbidden(true);
            close();
            model.reload();
          }}
          onInviteLink={setInviteLink}
          commandController={commandController}
          // Keep the minted link visible; invitation creation does not change the narrow member projection.
          onSuccess={() => {}}
          onReconcile={async () => {
            const reconciled = await model.reconcileInvitations();
            useStore
              .getState()
              .setNotice(
                reconciled ? m.settings_resource_member_invite_unknown() : m.settings_resource_member_unavailable(),
                "error",
              );
            return reconciled;
          }}
          onClose={close}
        />
      )}
      {error && !dialog && (
        <p role="alert" className="text-sm text-danger">
          {error}
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
