import { useLayoutEffect, useRef, useState } from "react";
import { m } from "@/i18n";
import { resolveRejectionMessage, teamAccessClient } from "@/account/teamAccessClient";
import type { TeamMember } from "@/account/teamAccessClient";
import { invalidateResourceAvatars } from "@/account/useResourceAvatars";

interface MemberResourceLinkRequestInput {
  member: TeamMember;
  workspaceId: string | null;
  reload(): void;
}

type ResolveResourceStatusOptions = { expectedResourceId: string | null | undefined; reconciled: boolean };
function resolveResourceStatus({ expectedResourceId, reconciled }: ResolveResourceStatusOptions): string {
  if (!reconciled) return "";
  return expectedResourceId === null
    ? m.settings_member_resource_remove_done()
    : m.settings_member_resource_update_done();
}

/** Link, relink or unlink; unlinking a member with no link is an immediate success. */
function requestResourceLinkChange(member: TeamMember, workspaceId: string, resourceId: string) {
  if (resourceId !== "")
    return teamAccessClient.setMemberResourceLink({
      workspaceId,
      principalId: member.userId,
      resourceId,
      expectedRevision: member.resourceLink?.revision ?? null,
    });
  if (member.resourceLink)
    return teamAccessClient.clearMemberResourceLink(workspaceId, member.userId, member.resourceLink.revision);
  return Promise.resolve({ kind: "ok", value: true, status: 204 } as const);
}

/**
 * Pending/error state plus a generation guard. `beginRequest` returns a `current()` check that stays
 * true only while that request is the latest one for the same company, so a slow reply can never
 * overwrite a newer choice or leak into another company after a switch.
 */
function useGuardedRequest(workspaceId: string | null, reload: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const currentWorkspace = useRef(workspaceId);
  useLayoutEffect(() => {
    currentWorkspace.current = workspaceId;
    requestGeneration.current += 1;
  }, [workspaceId]);
  const beginRequest = (activeWorkspaceId: string) => {
    const generation = ++requestGeneration.current;
    setPending(true);
    setError(null);
    return () => generation === requestGeneration.current && currentWorkspace.current === activeWorkspaceId;
  };
  const finishRequest = (current: () => boolean) => {
    if (current()) {
      reload();
      setPending(false);
    }
  };
  return { pending, error, setError, beginRequest, finishRequest };
}

/**
 * Request state for one member's resource link: create/update/unlink and exception dismissal.
 * `statusMessage` announces success only once the reloaded member shows the requested link.
 */
export function useMemberResourceLinkRequest({ member, workspaceId, reload }: MemberResourceLinkRequestInput) {
  const { pending, error, setError, beginRequest, finishRequest } = useGuardedRequest(workspaceId, reload);
  const [expectedResourceId, setExpectedResourceId] = useState<string | null | undefined>(undefined);

  const change = (resourceId: string) => {
    if (!workspaceId) return;
    const current = beginRequest(workspaceId);
    setExpectedResourceId(undefined);
    void requestResourceLinkChange(member, workspaceId, resourceId)
      .then((result) => {
        if (!current()) return;
        if (result.kind === "unknown" || result.kind === "invalid") setError(m.settings_member_resource_unknown());
        else if (result.kind === "rejected")
          setError(resolveRejectionMessage(result, m.settings_member_resource_error()));
        else setExpectedResourceId(resourceId === "" ? null : resourceId);
        if (result.kind !== "rejected") invalidateResourceAvatars();
      })
      .catch((cause: unknown) => {
        console.warn("Resource link request failed", cause);
        if (current()) {
          setError(m.settings_member_resource_unknown());
          invalidateResourceAvatars();
        }
      })
      .finally(() => finishRequest(current));
  };

  const dismissException = () => {
    if (!workspaceId || !member.resourceLinkException) return;
    const current = beginRequest(workspaceId);
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
      .finally(() => finishRequest(current));
  };

  const reconciled =
    !pending && expectedResourceId !== undefined && (member.resourceLink?.resourceId ?? null) === expectedResourceId;
  return {
    pending,
    error,
    statusMessage: resolveResourceStatus({ expectedResourceId: expectedResourceId, reconciled: reconciled }),
    change,
    dismissException,
  };
}
