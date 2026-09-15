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

export type ResourceMemberActionsModel = {
  canManage: boolean;
  authMode: ReturnType<typeof useAuth>["authMode"];
  members: readonly TeamMember[];
  reload(): void;
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
/* eslint-disable react-refresh/only-export-components, complexity */
export function useResourceMemberActionsModel(accountId: string | null): ResourceMemberActionsModel {
  const { authMode, user } = useAuth();
  const offline = useOfflineState();
  const online = useOnline();
  const enabled = authMode !== "off" && isServerConfigured();
  const membershipRevision = useStore((state) => state.membershipRevision);
  const [directory, setDirectory] = useState<{
    accountId: string;
    userId: string;
    members: TeamMember[];
  } | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const requestGeneration = useRef(0);
  const directoryKey = `${accountId ?? ""}\u0000${user?.id ?? ""}\u0000${authMode}\u0000${offline.readOnly}\u0000${membershipRevision}`;
  useEffect(() => {
    const generation = ++requestGeneration.current;
    const current = () => requestGeneration.current === generation;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDirectory(null);
    setDirectoryError(null);
    if (!enabled || !accountId || !user || offline.readOnly || !online) return;
    void teamAccessClient
      .listMembers(accountId)
      .then((result) => {
        if (!current()) return;
        if (result.kind !== "ok") {
          setDirectoryError(resolveRejectionMessage(result, m.settings_resource_member_unavailable()));
          return;
        }
        setDirectory({ accountId, userId: user.id, members: result.value.members });
      })
      .catch((cause: unknown) => {
        if (current()) setDirectoryError(resolveErrorMessage(cause));
      });
    return () => {
      requestGeneration.current += 1;
    };
  }, [accountId, authMode, directoryKey, enabled, membershipRevision, offline.readOnly, online, reloadKey, user]);
  const members = directory?.accountId === accountId && directory.userId === user?.id ? directory.members : [];
  const self = members.find((member) => member.isSelf);
  return {
    members,
    authMode,
    reload: () => {
      requestGeneration.current += 1;
      setDirectory(null);
      setDirectoryError(null);
      setReloadKey((value) => value + 1);
      // The Team projection and validated avatar projection share this revision boundary.
      useStore.getState().invalidateMemberships();
    },
    directoryError,
    contextKey: directoryKey,
    canManage:
      enabled &&
      online &&
      !offline.readOnly &&
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

// eslint-disable-next-line max-lines-per-function
export function ResourceMemberActions({ resource, accountId, model }: ResourceMemberActionsProps) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const requestGeneration = useRef(0);
  const [commandController] = useState(createMemberResourceCommandController);
  const linkedMember = model.members.find((candidate) => candidate.resourceLink?.resourceId === resource.id);

  useEffect(() => {
    requestGeneration.current += 1;
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
    }
    // A rejected mutation invalidates this local capability until the next authoritative directory read.
    if (model.canManage) setForbidden(false);
  }, [accountId, commandController, model.canManage, model.contextKey]);

  if (resource.kind !== "person" || resource.archivedAt || resource.deletedAt || !model.canManage || forbidden)
    return null;

  const open = (kind: "link" | "invite") => {
    setError(null);
    setInviteLink(null);
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
      onClick={onClick}
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
              onForbidden={() => {
                requestGeneration.current += 1;
                setForbidden(true);
                setDialog(null);
                setError(null);
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
          }}
          onSuccess={() => {
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
          }}
          onInviteLink={setInviteLink}
          commandController={commandController}
          // Keep the minted link visible; invitation creation does not change the narrow member projection.
          onSuccess={() => {}}
          onReconcile={model.reload}
          onClose={close}
        />
      )}
    </>
  );
}

function RemoveResourceMemberLinkButton({
  resource,
  accountId,
  member,
  pending,
  commandController,
  setPending,
  setError,
  reload,
  onForbidden,
}: {
  resource: Resource;
  accountId: string | null;
  member: TeamMember;
  pending: boolean;
  commandController: ReturnType<typeof createMemberResourceCommandController>;
  setPending: (value: boolean) => void;
  setError: (value: string | null) => void;
  reload(): void;
  onForbidden(): void;
}) {
  const remove = () => {
    if (!accountId || !member.resourceLink) return;
    const command = commandController.begin(`unlink:${accountId}:${member.userId}`);
    if (!command) return;
    setPending(true);
    setError(null);
    void teamAccessClient
      .clearMemberResourceLink(accountId, member.userId, member.resourceLink.revision)
      .then((result) => {
        if (!command.isCurrent()) return;
        if (result.kind !== "ok") setError(resolveRejectionMessage(result, m.settings_resource_member_error()));
        else {
          invalidateResourceAvatars();
          reload();
        }
        if (result.kind === "rejected" && result.status === 403) onForbidden();
      })
      .catch((cause: unknown) => {
        if (command.isCurrent()) setError(resolveErrorMessage(cause));
      })
      .finally(() => {
        if (command.isCurrent()) setPending(false);
        command.release();
      });
  };
  return (
    <Button
      type="button"
      size="sm"
      variant="danger-soft"
      aria-label={`${m.settings_resource_member_remove_link()} ${resource.name ?? resource.role}`}
      onClick={remove}
      disabled={pending}
    >
      {m.settings_resource_member_remove_link()}
    </Button>
  );
}
