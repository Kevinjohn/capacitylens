import { useState } from "react";
import { m } from "@/i18n";
import type { Role } from "@capacitylens/shared/domain/access";
import { resolveRejectionMessage, teamAccessClient, type TeamMember } from "../../account/teamAccessClient";
import { useStore } from "../../store/useStore";
import { invalidateResourceAvatars } from "../../account/useResourceAvatars";

/** Account-admin control linking a login member to one active scheduled person. */
// The branches mirror the complete selector state machine: authorization, CAS create/update/unlink,
// retained inactive display, in-flight reconciliation and explicit error presentation.
// eslint-disable-next-line complexity, max-lines-per-function
export function MemberResourceLink({
  member,
  myRole,
  linkedResourceIds,
  reload,
}: {
  member: TeamMember;
  myRole: Role | undefined;
  linkedResourceIds: ReadonlySet<string>;
  reload(): void;
}) {
  const accountId = useStore((state) => state.activeAccountId);
  const resources = useStore((state) => state.data.resources);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  if (myRole !== "owner" && myRole !== "admin") return <td className="py-2 pr-3" />;
  const currentPerson = resources.find(
    (resource) => resource.accountId === accountId && resource.id === member.resourceLink?.resourceId,
  );
  const people = resources.filter(
    (resource) =>
      resource.accountId === accountId &&
      resource.kind === "person" &&
      !resource.archivedAt &&
      !resource.deletedAt &&
      (!linkedResourceIds.has(resource.id) || resource.id === member.resourceLink?.resourceId),
  );
  const memberLabel = member.name ?? member.email ?? member.userId;
  const currentPersonLabel =
    currentPerson?.name ?? currentPerson?.role ?? member.resourceLink?.resourceName ?? "scheduled person";
  const currentPersonInactive =
    Boolean(member.resourceLink && (!currentPerson || (currentPerson.archivedAt ?? currentPerson.deletedAt) != null)) ||
    member.resourceLink?.resourceStatus === "archived" ||
    member.resourceLink?.resourceStatus === "disabled";
  const canEdit = member.status === "active" && !currentPersonInactive && people.length > 0;
  const change = (resourceId: string) => {
    if (!accountId) return;
    setPending(true);
    setError(null);
    let request;
    if (resourceId !== "")
      request = teamAccessClient.setMemberResourceLink({
        workspaceId: accountId,
        principalId: member.userId,
        resourceId,
        expectedRevision: member.resourceLink?.revision ?? null,
      });
    else if (member.resourceLink)
      request = teamAccessClient.clearMemberResourceLink(accountId, member.userId, member.resourceLink.revision);
    else request = Promise.resolve({ kind: "ok", value: true, status: 204 } as const);
    void request
      .then((result) => {
        if (result.kind !== "ok") setError(resolveRejectionMessage(result, m.settings_member_resource_error()));
        else invalidateResourceAvatars();
      })
      .catch((cause: unknown) => {
        console.warn("Scheduled-person link request failed", cause);
        setError(m.settings_member_resource_error());
        invalidateResourceAvatars();
      })
      .finally(() => {
        reload();
        setPending(false);
      });
  };
  return (
    <td className="py-2 pr-3">
      <div className="flex flex-col items-start gap-1">
        <span data-testid="member-resource-status">
          {member.resourceLink ? `Linked to ${currentPersonLabel} in the schedule` : "Not linked to the schedule"}
        </span>
        {member.resourceLink && currentPersonInactive && (
          <span className="text-xs text-muted-foreground">
            {m.settings_member_resource_inactive({ name: currentPersonLabel })}
          </span>
        )}
        {editing && canEdit && (
          <select
            aria-label={`Choose scheduled person for ${memberLabel}`}
            data-testid="member-resource-link"
            className="max-w-48 rounded-md border border-input bg-background px-2 py-1 text-sm"
            disabled={pending || !accountId}
            value={member.resourceLink?.resourceId ?? ""}
            onChange={(event) => {
              change(event.currentTarget.value);
              setEditing(false);
            }}
          >
            <option value="">{m.settings_member_resource_unlinked()}</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name ?? person.role}
              </option>
            ))}
          </select>
        )}
        <div className="flex flex-wrap gap-2">
          {canEdit && !editing && (
            <button
              type="button"
              className="text-xs font-medium text-primary underline"
              disabled={pending || !accountId}
              aria-label={`${member.resourceLink ? "Change" : "Link"} scheduled person for ${memberLabel}`}
              onClick={() => setEditing(true)}
            >
              {member.resourceLink ? "Change" : "Link"}
            </button>
          )}
          {member.resourceLink && (
            <button
              type="button"
              className="text-xs font-medium text-danger underline"
              disabled={pending || !accountId}
              aria-label={`Remove scheduled-person link for ${memberLabel}`}
              onClick={() => change("")}
            >
              Remove
            </button>
          )}
        </div>
        <span className="text-xs text-muted-foreground">Access and scheduling are unchanged.</span>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </td>
  );
}
