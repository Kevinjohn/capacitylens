import { useEffect, useMemo, useState } from "react";
import type { InvitationRole } from "@capacitylens/shared/account/types";
import type { Resource } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { isAccountEmail } from "@capacitylens/shared/account/validation";
import { useAuth } from "../../auth/authContext";
import { isServerConfigured } from "../../data/apiConfig";
import { useOfflineState } from "../../data/useOfflineState";
import { useFieldError } from "../../hooks/useFieldError";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { invalidateResourceAvatars } from "../../account/useResourceAvatars";
import { resolveRejectionMessage, teamAccessClient, type TeamMember } from "../../account/teamAccessClient";
import { useTeamDirectory } from "../settings/useTeamDirectory";
import { Button } from "../ui/button";
import { Modal, SelectField, TextField } from "../common/ui";

export type ResourceMemberActionsModel = {
  canManage: boolean;
  members: readonly TeamMember[];
  reload(): void;
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
// eslint-disable-next-line react-refresh/only-export-components
export function useResourceMemberActionsModel(accountId: string | null): ResourceMemberActionsModel {
  const { authMode, user } = useAuth();
  const offline = useOfflineState();
  const online = useOnline();
  const { fail } = useFieldError();
  const enabled = authMode !== "off" && isServerConfigured();
  const state = useTeamDirectory({ enabled, activeAccountId: accountId, offlineReadOnly: offline.readOnly, fail });
  const members = state.directory.kind === "ready" ? state.directory.snapshot.members : [];
  const role = members.find((member) => member.isSelf)?.role;
  return {
    members,
    reload: state.reload,
    canManage:
      enabled &&
      online &&
      !offline.readOnly &&
      user !== null &&
      accountId !== null &&
      state.directory.kind === "ready" &&
      (role === "owner" || role === "admin"),
  };
}

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
  const linkedMember = model.members.find((candidate) => candidate.resourceLink?.resourceId === resource.id);
  const linkedMemberId = linkedMember?.userId;

  useEffect(() => {
    // Account/auth/offline transitions must discard any private selection or token immediately.
    if (!model.canManage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDialog(null);
      setError(null);
      setInviteLink(null);
    }
  }, [model.canManage, accountId]);

  if (resource.kind !== "person" || !model.canManage) return null;

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
            {action(m.settings_resource_member_change_link(), () => open("link"))}
            {action(
              m.settings_resource_member_remove_link(),
              () => {
                if (!accountId || !linkedMemberId || !linkedMember.resourceLink) return;
                setPending(true);
                setError(null);
                void teamAccessClient
                  .clearMemberResourceLink(accountId, linkedMemberId, linkedMember.resourceLink.revision)
                  .then((result) => {
                    if (result.kind !== "ok")
                      setError(resolveRejectionMessage(result, m.settings_resource_member_error()));
                    else {
                      invalidateResourceAvatars();
                      model.reload();
                    }
                  })
                  .catch((cause: unknown) => setError(resolveErrorMessage(cause)))
                  .finally(() => setPending(false));
              },
              true,
            )}
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
          linkedMember={linkedMember}
          pending={pending}
          error={error}
          onError={setError}
          onPending={setPending}
          onForbidden={close}
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
          pending={pending}
          error={error}
          inviteLink={inviteLink}
          onError={setError}
          onPending={setPending}
          onForbidden={close}
          onInviteLink={setInviteLink}
          onSuccess={model.reload}
          onClose={close}
        />
      )}
    </>
  );
}

// eslint-disable-next-line max-lines-per-function
function LinkResourceDialog({
  resource,
  accountId,
  members,
  linkedMember,
  pending,
  error,
  onError,
  onPending,
  onForbidden,
  onSuccess,
  onClose,
}: {
  resource: Resource;
  accountId: string | null;
  members: readonly TeamMember[];
  linkedMember: TeamMember | undefined;
  pending: boolean;
  error: string | null;
  onError: (value: string | null) => void;
  onPending: (value: boolean) => void;
  onForbidden: () => void;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [memberId, setMemberId] = useState(linkedMember?.userId ?? "");
  const options = useMemo(
    () =>
      members
        .filter((member) => member.status === "active")
        .filter((member) => !member.resourceLink || member.userId === linkedMember?.userId)
        .map((member) => ({ value: member.userId, label: member.name ?? member.email ?? member.userId })),
    [members, linkedMember?.userId],
  );
  const submit = () => {
    if (!accountId || !memberId) return;
    const target = members.find((member) => member.userId === memberId);
    if (!target) return;
    onPending(true);
    onError(null);
    void teamAccessClient
      .setMemberResourceLink({
        workspaceId: accountId,
        principalId: memberId,
        resourceId: resource.id,
        expectedRevision: target.resourceLink?.revision ?? null,
      })
      .then((result) => {
        if (result.kind !== "ok") {
          onError(resolveRejectionMessage(result, m.settings_resource_member_error()));
          if (result.kind === "rejected" && result.status === 403) onForbidden();
        } else onSuccess();
      })
      .catch((cause: unknown) => onError(resolveErrorMessage(cause)))
      .finally(() => onPending(false));
  };
  return (
    <Modal
      title={m.settings_resource_member_link_title({ resource: resource.name ?? resource.role })}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {m.settings_member_resource_cancel()}
          </Button>
          <Button type="submit" disabled={pending || options.length === 0}>
            {m.settings_resource_member_submit_link()}
          </Button>
        </>
      }
    >
      <SelectField
        label={m.settings_resource_member_member_label()}
        ariaLabel={m.settings_resource_member_member_aria({ resource: resource.name ?? resource.role })}
        value={memberId}
        onChange={setMemberId}
        options={options}
        disabled={pending}
      />
      {options.length === 0 && (
        <p className="text-sm text-muted-foreground">{m.settings_resource_member_no_members()}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}

// eslint-disable-next-line max-lines-per-function
function InviteResourceDialog({
  resource,
  accountId,
  pending,
  error,
  inviteLink,
  onError,
  onPending,
  onForbidden,
  onInviteLink,
  onSuccess,
  onClose,
}: {
  resource: Resource;
  accountId: string | null;
  pending: boolean;
  error: string | null;
  inviteLink: string | null;
  onError: (value: string | null) => void;
  onPending: (value: boolean) => void;
  onForbidden: () => void;
  onInviteLink: (value: string | null) => void;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const submit = () => {
    if (!accountId) return;
    const trimmed = email.trim();
    if (trimmed && !isAccountEmail(trimmed)) {
      onError(m.identity_err_email());
      return;
    }
    onPending(true);
    onError(null);
    void teamAccessClient
      .createInvitation({
        accountId,
        role: "editor" satisfies InvitationRole,
        ...(trimmed ? { preauthEmail: trimmed } : {}),
        proposedResourceId: resource.id,
      })
      .then((result) => {
        if (result.kind !== "ok") {
          onError(resolveRejectionMessage(result, m.settings_resource_member_invite_error()));
          if (result.kind === "rejected" && result.status === 403) onForbidden();
          return;
        }
        onInviteLink(`${window.location.origin}/invite/${encodeURIComponent(result.value.token)}`);
        onSuccess();
      })
      .catch((cause: unknown) => onError(resolveErrorMessage(cause)))
      .finally(() => onPending(false));
  };
  return (
    <Modal
      title={m.settings_resource_member_invite_title({ resource: resource.name ?? resource.role })}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {m.settings_member_resource_cancel()}
          </Button>
          <Button type="submit" disabled={pending || inviteLink !== null}>
            {m.settings_resource_member_submit_invite()}
          </Button>
        </>
      }
    >
      <TextField
        label={m.settings_resource_member_invite_email()}
        ariaLabel={m.settings_resource_member_invite_email_aria({ resource: resource.name ?? resource.role })}
        type="email"
        value={email}
        onChange={(value) => {
          setEmail(value);
          onError(null);
        }}
        description={m.settings_resource_member_invite_email_help()}
        disabled={pending || inviteLink !== null}
      />
      {inviteLink && (
        <div className="flex flex-col gap-2 rounded border border-ok/40 bg-ok/5 p-3" role="status" aria-live="polite">
          <p className="text-sm font-medium text-ok">{m.settings_resource_member_invite_created()}</p>
          <code className="break-all text-xs">{inviteLink}</code>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(inviteLink);
            }}
          >
            {m.settings_resource_member_copy_invite()}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}
