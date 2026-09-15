/* eslint-disable max-lines-per-function, complexity */
import { useEffect, useRef, useState } from "react";
import { m } from "@/i18n";
import type { Role } from "@capacitylens/shared/domain/access";
import type { TeamMember } from "../../account/teamAccessClient";
import { useMemberResourceLinkMutation } from "./useMemberResourceLinkMutation";

/** Account-admin control linking a login member to one active scheduled person. */
export function MemberResourceLink({
  member,
  myRole,
  linkedResourceIds,
  resourceCandidates,
  workspaceId,
  reload,
}: {
  member: TeamMember;
  myRole: Role | undefined;
  linkedResourceIds: ReadonlySet<string>;
  resourceCandidates: readonly { resourceId: string; label: string }[];
  workspaceId: string | null;
  reload(): void;
}) {
  const [editing, setEditing] = useState(false);
  const selectorRef = useRef<HTMLSelectElement | null>(null);
  const statusRef = useRef<HTMLSpanElement | null>(null);
  const restoreFocusRef = useRef(false);
  const mutation = useMemberResourceLinkMutation({
    workspaceId,
    contextKey: `${workspaceId ?? ""}:${member.userId}:${myRole ?? ""}`,
    reload,
    onForbidden: () => {
      setEditing(false);
      reload();
    },
  });

  useEffect(() => {
    if (editing) {
      selectorRef.current?.focus();
      return;
    }
    if (!mutation.pending && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      statusRef.current?.focus();
    }
  }, [editing, mutation.pending]);

  if (myRole !== "owner" && myRole !== "admin") return <td className="py-2 pr-3" />;
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
    setEditing(false);
    void mutation.mutate({
      principalId: member.userId,
      resourceId,
      expectedRevision: member.resourceLink?.revision ?? null,
    });
  };
  const dismissException = () => {
    if (!workspaceId || !member.resourceLinkException) return;
    restoreFocusRef.current = true;
    setEditing(false);
    void mutation.dismiss(member.userId);
  };
  let exceptionMessage: string | null = null;
  if (member.resourceLinkException?.reason === "resource_already_linked")
    exceptionMessage = m.settings_member_resource_attention_occupied();
  else if (member.resourceLinkException?.reason === "member_already_linked")
    exceptionMessage = m.settings_member_resource_attention_member_linked();
  else if (member.resourceLinkException) exceptionMessage = m.settings_member_resource_attention_unavailable();
  return (
    <td className="py-2 pr-3">
      <div className="flex flex-col items-start gap-1">
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
                  disabled={mutation.pending || !workspaceId}
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
                disabled={mutation.pending || !workspaceId}
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
            disabled={mutation.pending || !workspaceId}
            value={member.resourceLink?.resourceId ?? ""}
            onChange={(event) => change(event.currentTarget.value)}
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
              disabled={mutation.pending || !workspaceId}
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
              disabled={mutation.pending || !workspaceId}
              aria-label={m.settings_member_resource_remove_aria({ member: memberLabel })}
              onClick={() => change("")}
            >
              {m.settings_member_resource_remove()}
            </button>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{m.settings_member_resource_explanation()}</span>
      </div>
      {mutation.error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {mutation.error}
        </p>
      )}
    </td>
  );
}
