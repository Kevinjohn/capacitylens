import { useState } from "react";
import { m } from "@/i18n";
import type { Role } from "@capacitylens/shared/domain/access";
import { resolveRejectionMessage, teamAccessClient, type TeamMember } from "../../account/teamAccessClient";
import { useStore } from "../../store/useStore";
import { invalidateResourceAvatars } from "../../account/useResourceAvatars";

/** Account-admin control linking a login member to one active scheduled person. */
// The branches mirror the complete selector state machine: authorization, CAS create/update/unlink,
// retained inactive display, in-flight reconciliation and explicit error presentation.
// eslint-disable-next-line complexity
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
  const memberLabel = member.name ?? member.email ?? member.userId;
  const currentPersonLabel = currentPerson ? (currentPerson.name ?? currentPerson.role) : "";
  return (
    <td className="py-2 pr-3">
      <select
        aria-label={`${m.settings_member_col_scheduled_person()}: ${memberLabel}`}
        data-testid="member-resource-link"
        className="max-w-48 rounded-md border border-input bg-background px-2 py-1 text-sm"
        disabled={pending || !accountId}
        value={member.resourceLink?.resourceId ?? ""}
        onChange={(event) => change(event.currentTarget.value)}
      >
        <option value="">{m.settings_member_resource_unlinked()}</option>
        {currentPerson && (currentPerson.archivedAt ?? currentPerson.deletedAt) && (
          <option value={currentPerson.id}>{m.settings_member_resource_inactive({ name: currentPersonLabel })}</option>
        )}
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name ?? person.role}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </td>
  );
}
