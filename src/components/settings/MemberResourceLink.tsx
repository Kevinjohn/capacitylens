import { useEffect, useRef, useState } from "react";
import { m } from "@/i18n";
import type { Role } from "@capacitylens/shared/domain/access";
import { resolveRejectionMessage, teamAccessClient, type TeamMember } from "../../account/teamAccessClient";
import { invalidateResourceAvatars } from "../../account/useResourceAvatars";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Button } from "../ui/button";
import { Link as LinkIcon } from "lucide-react";

/** Account-admin control linking a login member to one eligible person Resource. */
// The branches mirror the complete selector state machine: authorization, CAS create/update/unlink,
// retained inactive display, in-flight reconciliation and explicit error presentation.
// eslint-disable-next-line complexity, max-lines-per-function
export function MemberResourceLink({
  member,
  myRole,
  linkedResourceIds,
  resourceCandidates,
  workspaceId,
  reload,
  dialog = false,
}: {
  member: TeamMember;
  myRole: Role | undefined;
  linkedResourceIds: ReadonlySet<string>;
  resourceCandidates: readonly { resourceId: string; label: string }[];
  workspaceId: string | null;
  reload(): void;
  /** Render inside the centered resource-link dialog instead of a table cell. */
  dialog?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The row icon opens the editor directly. The non-dialog cell remains a compact status-only
  // view, while the centered dialog starts with its selector ready for the requested change.
  const [editing, setEditing] = useState(dialog);
  const selectorRef = useRef<HTMLSelectElement | null>(null);
  const statusRef = useRef<HTMLSpanElement | null>(null);
  const restoreFocusRef = useRef(false);
  const requestGeneration = useRef(0);
  useEffect(() => {
    if (editing) {
      selectorRef.current?.focus();
      return;
    }
    if (!pending && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      statusRef.current?.focus();
    }
  }, [editing, pending]);
  if (myRole !== "owner" && myRole !== "admin") return dialog ? <div /> : <td className="py-2 px-4" />;
  const currentPerson = resourceCandidates.find((resource) => resource.resourceId === member.resourceLink?.resourceId);
  const people = resourceCandidates
    .filter(
      (resource) =>
        !linkedResourceIds.has(resource.resourceId) || resource.resourceId === member.resourceLink?.resourceId,
    )
    .map((resource) => ({ id: resource.resourceId, name: resource.label }));
  const memberLabel = member.name ?? member.email ?? member.userId;
  const currentPersonLabel =
    currentPerson?.label ?? member.resourceLink?.resourceName ?? m.settings_member_resource_default_person();
  const currentPersonInactive =
    Boolean(member.resourceLink && !currentPerson) ||
    member.resourceLink?.resourceStatus === "archived" ||
    member.resourceLink?.resourceStatus === "disabled";
  const canEdit = member.status === "active" && !currentPersonInactive && people.length > 0;
  const hasException = member.resourceLinkException !== null && member.resourceLinkException !== undefined;
  const change = (resourceId: string) => {
    restoreFocusRef.current = true;
    if (!workspaceId) return;
    const generation = ++requestGeneration.current;
    const current = () => generation === requestGeneration.current;
    setPending(true);
    setError(null);
    let request;
    if (resourceId !== "")
      request = teamAccessClient.setMemberResourceLink({
        workspaceId,
        principalId: member.userId,
        resourceId,
        expectedRevision: member.resourceLink?.revision ?? null,
      });
    else if (member.resourceLink)
      request = teamAccessClient.clearMemberResourceLink(workspaceId, member.userId, member.resourceLink.revision);
    else request = Promise.resolve({ kind: "ok", value: true, status: 204 } as const);
    void request
      .then((result) => {
        if (!current()) return;
        if (result.kind !== "ok") setError(resolveRejectionMessage(result, m.settings_member_resource_error()));
        else invalidateResourceAvatars();
      })
      .catch((cause: unknown) => {
        console.warn("Resource link request failed", cause);
        if (current()) setError(m.settings_member_resource_error());
        invalidateResourceAvatars();
      })
      .finally(() => {
        if (current()) {
          reload();
          setPending(false);
        }
      });
  };
  const dismissException = () => {
    if (!workspaceId || !member.resourceLinkException) return;
    const generation = ++requestGeneration.current;
    const current = () => generation === requestGeneration.current;
    restoreFocusRef.current = true;
    setPending(true);
    setError(null);
    void teamAccessClient
      .dismissMemberResourceLinkException(workspaceId, member.userId)
      .then((result) => {
        if (!current()) return;
        if (result.kind !== "ok") setError(resolveRejectionMessage(result, m.settings_member_resource_error()));
        else invalidateResourceAvatars();
      })
      .catch((cause: unknown) => {
        console.warn("Resource link exception dismissal failed", cause);
        if (current()) setError(m.settings_member_resource_error());
      })
      .finally(() => {
        if (current()) {
          reload();
          setPending(false);
        }
      });
  };
  let exceptionMessage: string | null = null;
  if (member.resourceLinkException?.reason === "resource_already_linked")
    exceptionMessage = m.settings_member_resource_attention_occupied();
  else if (member.resourceLinkException?.reason === "member_already_linked")
    exceptionMessage = m.settings_member_resource_attention_member_linked();
  else if (member.resourceLinkException) exceptionMessage = m.settings_member_resource_attention_unavailable();
  if (!dialog) {
    return (
      <td className="py-2 px-4" data-testid="member-resource-cell">
        <div className="flex flex-col items-start gap-1">
          <span ref={statusRef} tabIndex={-1} aria-live="polite" data-testid="member-resource-status">
            {member.resourceLink
              ? m.settings_member_resource_linked({ name: currentPersonLabel })
              : m.settings_member_resource_not_linked()}
          </span>
          {exceptionMessage && (
            <span className="text-xs text-warn">
              {m.settings_member_resource_attention_heading()}: {exceptionMessage}
            </span>
          )}
          {member.resourceLink && currentPersonInactive && (
            <span className="text-xs text-muted-foreground">
              {m.settings_member_resource_inactive({ name: currentPersonLabel })}
            </span>
          )}
        </div>
      </td>
    );
  }
  const content = (
    <div className="flex flex-col items-start gap-2">
      <span ref={statusRef} tabIndex={-1} aria-live="polite" data-testid="member-resource-status">
        {member.resourceLink
          ? m.settings_member_resource_linked({ name: currentPersonLabel })
          : m.settings_member_resource_not_linked()}
      </span>
      {exceptionMessage && (
        <div className="flex flex-col items-start gap-1 rounded border border-warn/40 bg-warn/5 p-2 text-xs">
          <strong className="font-medium text-ink">{m.settings_member_resource_attention_heading()}</strong>
          <span>{exceptionMessage}</span>
          <div className="flex flex-wrap gap-2">
            {canEdit && !editing && (
              <button
                type="button"
                className="font-medium text-primary underline"
                disabled={pending || !workspaceId}
                onClick={() => {
                  restoreFocusRef.current = true;
                  setEditing(true);
                }}
              >
                {m.settings_member_resource_choose_another()}
              </button>
            )}
            <button
              type="button"
              className="font-medium text-muted-foreground underline"
              disabled={pending || !workspaceId}
              onClick={dismissException}
            >
              {m.settings_member_resource_dismiss()}
            </button>
          </div>
        </div>
      )}
      {member.resourceLink && currentPersonInactive && (
        <span className="text-xs text-muted-foreground">
          {m.settings_member_resource_inactive({ name: currentPersonLabel })}
        </span>
      )}
      {editing && canEdit && (
        <select
          ref={selectorRef}
          aria-label={m.settings_member_resource_choose_aria({ member: memberLabel })}
          data-testid="member-resource-link"
          className="max-w-48 rounded-md border border-input bg-background px-2 py-1 text-sm"
          disabled={pending || !workspaceId}
          value={member.resourceLink?.resourceId ?? ""}
          onChange={(event) => {
            change(event.currentTarget.value);
            setEditing(false);
          }}
        >
          <option value="">{m.settings_member_resource_unlinked()}</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      )}
      <div className="flex flex-wrap gap-2">
        {editing && canEdit && (
          <button
            type="button"
            className="text-xs font-medium text-primary underline"
            onClick={() => {
              restoreFocusRef.current = true;
              setEditing(false);
            }}
          >
            {m.settings_member_resource_cancel()}
          </button>
        )}
        {canEdit && !editing && !hasException && (
          <button
            type="button"
            className="text-xs font-medium text-primary underline"
            disabled={pending || !workspaceId}
            aria-label={
              member.resourceLink
                ? m.settings_member_resource_change_aria({ member: memberLabel })
                : m.settings_member_resource_link_aria({ member: memberLabel })
            }
            onClick={() => {
              restoreFocusRef.current = true;
              setEditing(true);
            }}
          >
            {member.resourceLink ? m.settings_member_resource_change() : m.settings_member_resource_link()}
          </button>
        )}
        {member.resourceLink && (
          <button
            type="button"
            className="text-xs font-medium text-danger underline"
            disabled={pending || !workspaceId}
            aria-label={m.settings_member_resource_remove_aria({ member: memberLabel })}
            onClick={() => change("")}
          >
            {m.settings_member_resource_remove()}
          </button>
        )}
      </div>
      <span className="text-xs text-muted-foreground">{m.settings_member_resource_explanation()}</span>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
  return content;
}

/** Row action that opens the resource-link editor without mixing it into lifecycle settings. */
export function MemberResourceDialog({
  member,
  myRole,
  linkedResourceIds,
  resourceCandidates,
  workspaceId,
  reload,
  busy,
}: {
  member: TeamMember;
  myRole: Role | undefined;
  linkedResourceIds: ReadonlySet<string>;
  resourceCandidates: readonly { resourceId: string; label: string }[];
  workspaceId: string | null;
  reload(): void;
  busy: boolean;
}) {
  if (myRole !== "owner" && myRole !== "admin") return null;
  const memberLabel = member.name ?? member.email ?? member.userId;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          title={m.settings_member_resource_link_aria({ member: memberLabel })}
          aria-label={m.settings_member_resource_link_aria({ member: memberLabel })}
          data-testid="member-resource-menu"
          disabled={busy}
        >
          <LinkIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" aria-describedby={`member-resource-description-${member.userId}`}>
        <DialogHeader>
          <DialogTitle>{m.settings_member_col_scheduled_person()}</DialogTitle>
          <DialogDescription id={`member-resource-description-${member.userId}`}>{memberLabel}</DialogDescription>
        </DialogHeader>
        <MemberResourceLink
          member={member}
          myRole={myRole}
          linkedResourceIds={linkedResourceIds}
          resourceCandidates={resourceCandidates}
          workspaceId={workspaceId}
          reload={reload}
          dialog
        />
      </DialogContent>
    </Dialog>
  );
}
