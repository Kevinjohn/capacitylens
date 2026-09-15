import type { RefObject } from "react";
import type { Resource } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import type { TeamMember } from "../../account/teamAccessClient";
import type { useMemberResourceLinkMutation } from "../settings/useMemberResourceLinkMutation";
import { Button } from "../ui/button";

export function RemoveResourceMemberLinkButton({
  resource,
  member,
  mutation,
  returnFocusRef,
  onSuccess,
}: {
  resource: Resource;
  member: TeamMember;
  mutation: ReturnType<typeof useMemberResourceLinkMutation>;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onSuccess(): void;
}) {
  const remove = () => {
    if (!member.resourceLink) return;
    void mutation
      .mutate({
        principalId: member.userId,
        resourceId: "",
        expectedRevision: member.resourceLink.revision,
      })
      .then((result) => {
        if (result.kind === "ok") onSuccess();
      });
  };
  return (
    <Button
      type="button"
      ref={returnFocusRef}
      size="sm"
      variant="danger-soft"
      aria-label={`${m.settings_resource_member_remove_link()} ${resource.name ?? resource.role}`}
      onClick={remove}
      disabled={mutation.pending}
    >
      {m.settings_resource_member_remove_link()}
    </Button>
  );
}
