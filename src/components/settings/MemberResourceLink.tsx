import { useEffect, useRef, useState } from "react";
import { m } from "@/i18n";
import type { Role } from "@capacitylens/shared/domain/access";
import { resolveRejectionMessage, teamAccessClient, type TeamMember } from "../../account/teamAccessClient";
import { invalidateResourceAvatars } from "../../account/useResourceAvatars";
import { Modal, SelectField } from "../common/ui";
import { Button } from "../ui/button";
import { Link as LinkIcon } from "lucide-react";

function resolveResourceStatus(expectedResourceId: string | null | undefined, reconciled: boolean): string {
  if (!reconciled) return "";
  return expectedResourceId === null
    ? m.settings_member_resource_remove_done()
    : m.settings_member_resource_update_done();
}

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
  const [expectedResourceId, setExpectedResourceId] = useState<string | null | undefined>(undefined);
  // The row icon opens the editor directly. The non-dialog cell remains a compact status-only
  // view, while the centered dialog starts with its selector ready for the requested change.
  const requestGeneration = useRef(0);
  const selectorScopeRef = useRef<HTMLDivElement>(null);
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
  const change = (resourceId: string) => {
    if (!workspaceId) return;
    const generation = ++requestGeneration.current;
    const current = () => generation === requestGeneration.current;
    setPending(true);
    setError(null);
    setExpectedResourceId(undefined);
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
        else {
          setExpectedResourceId(resourceId === "" ? null : resourceId);
          invalidateResourceAvatars();
        }
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
  const resourceLinkReconciled =
    !pending && expectedResourceId !== undefined && (member.resourceLink?.resourceId ?? null) === expectedResourceId;
  const statusMessage = resolveResourceStatus(expectedResourceId, resourceLinkReconciled);
  if (!dialog) {
    return (
      <td className="py-2 px-4" data-testid="member-resource-cell">
        <div className="flex flex-col items-start gap-1">
          <span className="text-xs text-muted-foreground" aria-live="polite" data-testid="member-resource-status">
            {member.resourceLink ? currentPersonLabel : m.settings_member_resource_not_linked()}
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
    <div ref={selectorScopeRef} className="flex flex-col items-start gap-2">
      {exceptionMessage && (
        <div className="flex flex-col items-start gap-1 rounded border border-warn/40 bg-warn/5 p-2 text-xs">
          <strong className="font-medium text-ink">{m.settings_member_resource_attention_heading()}</strong>
          <span>{exceptionMessage}</span>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || !workspaceId}
                onClick={() =>
                  selectorScopeRef.current?.querySelector<HTMLElement>('[data-testid="member-resource-link"]')?.focus()
                }
              >
                {m.settings_member_resource_choose_another()}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending || !workspaceId}
              onClick={dismissException}
            >
              {m.settings_member_resource_dismiss()}
            </Button>
          </div>
        </div>
      )}
      {member.resourceLink && currentPersonInactive && (
        <span className="text-xs text-muted-foreground">
          {m.settings_member_resource_inactive({ name: currentPersonLabel })}
        </span>
      )}
      {canEdit && (
        <SelectField
          label={m.settings_member_col_scheduled_person()}
          ariaLabel={m.settings_member_resource_choose_aria({ member: memberLabel })}
          testId="member-resource-link"
          autoFocus
          layout="label-control"
          disabled={pending || !workspaceId}
          value={member.resourceLink?.resourceId ?? ""}
          options={[
            { value: "", label: m.settings_member_resource_unlinked() },
            ...people.map((person) => ({ value: person.id, label: person.name })),
          ]}
          onChange={(resourceId) => {
            change(resourceId);
          }}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {member.resourceLink && (
          <Button
            type="button"
            size="sm"
            variant="danger-soft"
            disabled={pending || !workspaceId}
            aria-label={m.settings_member_resource_remove_aria({ member: memberLabel })}
            onClick={() => change("")}
          >
            {m.settings_member_resource_remove()}
          </Button>
        )}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {pending ? m.settings_members_updating() : statusMessage}
      </span>
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
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) requestAnimationFrame(() => triggerRef.current?.focus());
    wasOpen.current = open;
  }, [open]);
  if (myRole !== "owner" && myRole !== "admin") return null;
  const memberLabel = member.name ?? member.email ?? member.userId;
  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        size="icon-sm"
        variant="outline"
        title={m.settings_member_resource_link_aria({ member: memberLabel })}
        aria-label={m.settings_member_resource_link_aria({ member: memberLabel })}
        data-testid="member-resource-menu"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        <LinkIcon />
      </Button>
      {open && (
        <Modal
          title={m.settings_member_col_scheduled_person()}
          description={memberLabel}
          onClose={() => setOpen(false)}
          guardDirty={false}
          footer={
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              {m.settings_help_close()}
            </Button>
          }
        >
          <MemberResourceLink
            member={member}
            myRole={myRole}
            linkedResourceIds={linkedResourceIds}
            resourceCandidates={resourceCandidates}
            workspaceId={workspaceId}
            reload={reload}
            dialog
          />
        </Modal>
      )}
    </>
  );
}
