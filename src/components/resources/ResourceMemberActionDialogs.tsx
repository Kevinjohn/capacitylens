import { useId, useMemo, useRef, useState } from "react";
import type { InvitationRole } from "@capacitylens/shared/account/types";
import type { Resource } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import type { useAuth } from "../../auth/authContext";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { resolveRejectionMessage, teamAccessClient, type TeamMember } from "../../account/teamAccessClient";
import type { createMemberResourceCommandController } from "../../account/memberResourceCommandController";
import { validateInvitationEmail } from "../../account/invitationValidation";
import { Button } from "../ui/button";
import { Modal, SelectField, TextField } from "../common/ui";

// eslint-disable-next-line max-lines-per-function
export function LinkResourceDialog({
  resource,
  accountId,
  members,
  linkedMember,
  commandController,
  pending,
  error,
  onError,
  onPending,
  onForbidden,
  onReconcile,
  onSuccess,
  onClose,
}: {
  resource: Resource;
  accountId: string | null;
  members: readonly TeamMember[];
  linkedMember: TeamMember | undefined;
  commandController: ReturnType<typeof createMemberResourceCommandController>;
  pending: boolean;
  error: string | null;
  onError: (value: string | null) => void;
  onPending: (value: boolean) => void;
  onForbidden: () => void;
  onReconcile: () => void;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [memberId, setMemberId] = useState(linkedMember?.userId ?? "");
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const submitLock = useRef(false);
  const selectionErrorId = useId();
  const options = useMemo(
    () =>
      members
        .filter((member) => member.status === "active")
        .filter((member) => !member.resourceLink || member.userId === linkedMember?.userId)
        .map((member) => ({ value: member.userId, label: member.name ?? member.email ?? member.userId })),
    [members, linkedMember?.userId],
  );
  // eslint-disable-next-line complexity
  const submit = () => {
    if (submitLock.current || !accountId) return;
    if (!memberId) {
      const message = m.settings_resource_member_select_required();
      setSelectionError(message);
      onError(message);
      return;
    }
    if (!options.some((option) => option.value === memberId)) {
      const message = m.settings_invite_person_stale();
      setSelectionError(message);
      onError(message);
      return;
    }
    const target = members.find((member) => member.userId === memberId);
    if (!target) {
      const message = m.settings_invite_person_stale();
      setSelectionError(message);
      onError(message);
      return;
    }
    const previousLink = linkedMember?.resourceLink;
    const command = commandController.begin(`link:${accountId}:${resource.id}`);
    if (!command) return;
    submitLock.current = true;
    onPending(true);
    onError(null);
    setSelectionError(null);
    void teamAccessClient
      .setMemberResourceLink({
        workspaceId: accountId,
        principalId: memberId,
        resourceId: resource.id,
        expectedRevision: target.resourceLink?.revision ?? null,
        ...(linkedMember && previousLink && target.userId !== linkedMember.userId
          ? { replacePrincipalId: linkedMember.userId, replaceExpectedRevision: previousLink.revision }
          : {}),
      })
      .then(async (result) => {
        if (!command.isCurrent()) return;
        if (result.kind !== "ok") {
          onError(
            result.kind === "unknown" || result.kind === "invalid"
              ? m.settings_resource_member_unknown()
              : resolveRejectionMessage(result, m.settings_resource_member_error()),
          );
          if (result.kind === "unknown" || result.kind === "invalid") onReconcile();
          if (result.kind === "rejected" && result.status === 403) onForbidden();
        } else onSuccess();
      })
      .catch((cause: unknown) => {
        if (command.isCurrent()) onError(resolveErrorMessage(cause));
      })
      .finally(() => {
        submitLock.current = false;
        onPending(false);
        command.release();
      });
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
          <Button type="submit" disabled={pending || options.length === 0 || memberId === ""}>
            {m.settings_resource_member_submit_link()}
          </Button>
        </>
      }
    >
      <SelectField
        label={m.settings_resource_member_member_label()}
        ariaLabel={m.settings_resource_member_member_aria({ resource: resource.name ?? resource.role })}
        value={memberId}
        onChange={(value) => {
          setMemberId(value);
          setSelectionError(null);
          onError(null);
        }}
        options={options}
        required
        invalid={selectionError !== null}
        describedById={selectionErrorId}
        disabled={pending}
      />
      {options.length === 0 && (
        <p className="text-sm text-muted-foreground">{m.settings_resource_member_no_members()}</p>
      )}
      {selectionError && (
        <p id={selectionErrorId} role="alert" className="text-sm text-danger">
          {selectionError}
        </p>
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
export function InviteResourceDialog({
  resource,
  accountId,
  authMode,
  commandController,
  pending,
  error,
  inviteLink,
  onError,
  onPending,
  onForbidden,
  onInviteLink,
  onSuccess,
  onReconcile,
  onClose,
}: {
  resource: Resource;
  accountId: string | null;
  authMode: ReturnType<typeof useAuth>["authMode"];
  commandController: ReturnType<typeof createMemberResourceCommandController>;
  pending: boolean;
  error: string | null;
  inviteLink: string | null;
  onError: (value: string | null) => void;
  onPending: (value: boolean) => void;
  onForbidden: () => void;
  onInviteLink: (value: string | null) => void;
  onSuccess: () => void;
  onReconcile: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitationRole>("editor");
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const submitLock = useRef(false);
  const submit = () => {
    if (submitLock.current || !accountId) return;
    const emailValidation = validateInvitationEmail(authMode, email);
    if (emailValidation.kind === "invalid") {
      return onError(
        emailValidation.reason === "required" ? m.settings_sso_invite_email_required() : m.identity_err_email(),
      );
    }
    const trimmed = emailValidation.email;
    submitLock.current = true;
    const command = commandController.begin(`invite:${accountId}:${resource.id}`);
    if (!command) {
      submitLock.current = false;
      return;
    }
    onPending(true);
    onError(null);
    void teamAccessClient
      .createInvitation({
        accountId,
        role,
        ...(trimmed ? { preauthEmail: trimmed } : {}),
        proposedResourceId: resource.id,
      })
      .then(async (result) => {
        if (!command.isCurrent()) return;
        if (result.kind !== "ok") {
          onError(
            result.kind === "unknown" || result.kind === "invalid"
              ? m.settings_resource_member_invite_unknown()
              : resolveRejectionMessage(result, m.settings_resource_member_invite_error()),
          );
          if (result.kind === "unknown" || result.kind === "invalid") {
            setReconciling(true);
            await onReconcile();
            setReconciling(false);
          }
          if (result.kind === "rejected" && result.status === 403) onForbidden();
          return;
        }
        onInviteLink(`${window.location.origin}/invite/${encodeURIComponent(result.value.token)}`);
        onSuccess();
      })
      .catch((cause: unknown) => {
        if (command.isCurrent()) onError(resolveErrorMessage(cause));
      })
      .finally(() => {
        submitLock.current = false;
        onPending(false);
        command.release();
      });
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
          <Button type="submit" disabled={pending || reconciling || inviteLink !== null}>
            {m.settings_resource_member_submit_invite()}
          </Button>
        </>
      }
    >
      <TextField
        label={
          authMode === "sso" ? m.settings_invite_preauth_label_required() : m.settings_resource_member_invite_email()
        }
        ariaLabel={m.settings_resource_member_invite_email_aria({ resource: resource.name ?? resource.role })}
        type="email"
        value={email}
        onChange={(value) => {
          setEmail(value);
          onError(null);
        }}
        description={
          authMode === "sso"
            ? m.settings_invite_preauth_description_sso()
            : m.settings_resource_member_invite_email_help()
        }
        disabled={pending || inviteLink !== null}
      />
      <SelectField
        label={m.settings_invite_role_label()}
        ariaLabel={m.settings_invite_role_aria()}
        value={role}
        onChange={(value) => setRole(value as InvitationRole)}
        options={[
          { value: "admin", label: m.settings_role_admin() },
          { value: "editor", label: m.settings_role_editor() },
          { value: "viewer", label: m.settings_role_viewer() },
        ]}
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
              void navigator.clipboard
                .writeText(inviteLink)
                .then(() => setCopyNotice(m.settings_resource_member_copied()))
                .catch(() => setCopyNotice(m.settings_members_copy_failed()));
            }}
          >
            {m.settings_resource_member_copy_invite()}
          </Button>
          {copyNotice && (
            <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
              {copyNotice}
            </p>
          )}
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
