import type { RefObject } from "react";
import type { Resource } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { resolveRejectionMessage, teamAccessClient, type TeamMember } from "../../account/teamAccessClient";
import type { createMemberResourceCommandController } from "../../account/memberResourceCommandController";
import { invalidateResourceAvatars } from "../../account/useResourceAvatars";
import { Button } from "../ui/button";

export function RemoveResourceMemberLinkButton({
  resource,
  accountId,
  member,
  pending,
  commandController,
  setPending,
  setError,
  reload,
  returnFocusRef,
  onSuccess,
  onReconcile,
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
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onSuccess(): void;
  onReconcile(): void;
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
        if (result.kind !== "ok") {
          setError(
            result.kind === "unknown" || result.kind === "invalid"
              ? m.settings_resource_member_unknown()
              : resolveRejectionMessage(result, m.settings_resource_member_error()),
          );
          if (result.kind === "unknown" || result.kind === "invalid") onReconcile();
        } else {
          onSuccess();
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
      ref={returnFocusRef}
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
