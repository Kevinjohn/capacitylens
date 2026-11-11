import { useLayoutEffect, useRef, useState } from 'react';
import { m } from '@/i18n';
import { resolveRejectionMessage, teamAccessClient } from '@/account/teamAccessClient';
import type { TeamMember } from '@/account/teamAccessClient';
import { invalidateResourceAvatars } from '@/account/useResourceAvatars';

interface MemberResourceLinkRequestInput {
  member: TeamMember;
  workspaceId: string | null;
  /** Requests a fresh directory read and returns its generation. */
  reload(): number;
  /** Generation of the newest successful directory read that `member` comes from. */
  acceptedReadGeneration: number;
}

type ResolveResourceStatusOptions = {
  expectedResourceId: string | null | undefined;
  reconciled: boolean;
};
function resolveResourceStatus({
  expectedResourceId,
  reconciled,
}: ResolveResourceStatusOptions): string {
  if (!reconciled) return '';
  return expectedResourceId === null
    ? m.settings_member_resource_remove_done()
    : m.settings_member_resource_update_done();
}

function requestResourceLinkChange(member: TeamMember, workspaceId: string, resourceId: string) {
  if (resourceId !== '') {
    return teamAccessClient.setMemberResourceLink({
      workspaceId,
      principalId: member.userId,
      resourceId,
      expectedRevision: member.resourceLink?.revision ?? null,
    });
  }
  if (member.resourceLink) {
    return teamAccessClient.clearMemberResourceLink(
      workspaceId,
      member.userId,
      member.resourceLink.revision,
    );
  }
  return Promise.resolve({ kind: 'ok', value: true, status: 204 } as const);
}

// A request owns effects only while it is newest in the same company; reject late
// replies so they cannot overwrite a newer choice or cross tenants. A finished write stays
// pending until a read requested after it is accepted, so the next change sends a fresh revision.
function useGuardedRequest(workspaceId: string | null, reload: () => number) {
  const [sending, setSending] = useState(false);
  const [requiredReadGeneration, setRequiredReadGeneration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const currentWorkspace = useRef(workspaceId);
  useLayoutEffect(() => {
    currentWorkspace.current = workspaceId;
    requestGeneration.current += 1;
  }, [workspaceId]);
  const beginRequest = (activeWorkspaceId: string) => {
    const generation = ++requestGeneration.current;
    setSending(true);
    setError(null);
    return () =>
      generation === requestGeneration.current && currentWorkspace.current === activeWorkspaceId;
  };
  const finishRequest = (current: () => boolean) => {
    if (current()) {
      setRequiredReadGeneration(reload());
      setSending(false);
    }
  };
  return { sending, requiredReadGeneration, error, setError, beginRequest, finishRequest };
}

/**
 * Request state for one member's resource link: create/update/unlink and exception dismissal.
 * `statusMessage` announces success only once the reloaded member shows the requested link.
 */
export function useMemberResourceLinkRequest({
  member,
  workspaceId,
  reload,
  acceptedReadGeneration,
}: MemberResourceLinkRequestInput) {
  const { sending, requiredReadGeneration, error, setError, beginRequest, finishRequest } =
    useGuardedRequest(workspaceId, reload);
  const pending = sending || acceptedReadGeneration < requiredReadGeneration;
  const [expectedResourceId, setExpectedResourceId] = useState<string | null | undefined>(
    undefined,
  );

  const change = (resourceId: string) => {
    if (!workspaceId) return;
    const current = beginRequest(workspaceId);
    setExpectedResourceId(undefined);
    void requestResourceLinkChange(member, workspaceId, resourceId)
      .then((result) => {
        if (!current()) return;
        if (result.kind === 'unknown' || result.kind === 'invalid') {
          setError(m.settings_member_resource_unknown());
        } else if (result.kind === 'rejected') {
          setError(resolveRejectionMessage(result, m.settings_member_resource_error()));
        } else setExpectedResourceId(resourceId === '' ? null : resourceId);
        if (result.kind !== 'rejected') invalidateResourceAvatars();
      })
      .catch((cause: unknown) => {
        console.warn('Resource link request failed', cause);
        if (current()) {
          setError(m.settings_member_resource_unknown());
          invalidateResourceAvatars();
        }
      })
      .finally(() => finishRequest(current));
  };

  // A finished success is announced once; errors and unknown outcomes stay until the next change.
  // While the change is still pending, keep it so the reopened dialog announces its completion.
  const clearStatus = () => {
    if (!pending) setExpectedResourceId(undefined);
  };

  const reconciled =
    !pending &&
    expectedResourceId !== undefined &&
    (member.resourceLink?.resourceId ?? null) === expectedResourceId;
  return {
    pending,
    error,
    statusMessage: resolveResourceStatus({
      expectedResourceId: expectedResourceId,
      reconciled: reconciled,
    }),
    change,
    clearStatus,
  };
}
