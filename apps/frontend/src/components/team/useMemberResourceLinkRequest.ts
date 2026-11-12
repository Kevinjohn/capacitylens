import { useLayoutEffect, useRef, useState } from 'react';
import { m } from '@/i18n';
import { resolveRejectionMessage, teamAccessClient } from '@/account/teamAccessClient';
import type { TeamMember } from '@/account/teamAccessClient';
import { invalidateResourceAvatars } from '@/account/useResourceAvatars';

interface MemberResourceLinkRequestsInput {
  workspaceId: string | null;
  /** Requests a fresh directory read and returns its generation. */
  reload(): number;
  /** Generation of the newest successful directory read. */
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

interface MemberResourceLinkRequestState {
  sending: boolean;
  /** Generation of the directory read this member's last finished change requested. */
  requiredReadGeneration: number;
  error: string | null;
  expectedResourceId: string | null | undefined;
}

const IDLE_REQUEST: MemberResourceLinkRequestState = {
  sending: false,
  requiredReadGeneration: 0,
  error: null,
  expectedResourceId: undefined,
};

/** One member's resource-link request as the row and dialog see it. */
export interface MemberResourceLinkRequest {
  pending: boolean;
  error: string | null;
  statusMessage: string;
  change(resourceId: string): void;
  clearStatus(): void;
}

/**
 * Resource-link requests for every member of the section, keyed by member id so a request outlives
 * its row and dialog: closing the dialog, collapsing the inactive group or a failed directory read
 * all unmount them. A request owns effects only while it is that member's newest in the same
 * company, so late replies cannot overwrite a newer choice or cross tenants. A finished change
 * stays pending until a directory read requested after it is accepted, so the next change sends a
 * fresh revision. `statusMessage` announces success only once the reloaded member shows the link.
 */
export function useMemberResourceLinkRequests({
  workspaceId,
  reload,
  acceptedReadGeneration,
}: MemberResourceLinkRequestsInput): (member: TeamMember) => MemberResourceLinkRequest {
  const [requests, setRequests] = useState<ReadonlyMap<string, MemberResourceLinkRequestState>>(
    () => new Map(),
  );
  const latestRequestByMember = useRef(new Map<string, number>());
  const requestCount = useRef(0);
  const currentWorkspace = useRef(workspaceId);
  useLayoutEffect(() => {
    currentWorkspace.current = workspaceId;
    latestRequestByMember.current.clear();
  }, [workspaceId]);
  const update = (userId: string, patch: Partial<MemberResourceLinkRequestState>) => {
    setRequests((previous) =>
      new Map(previous).set(userId, { ...(previous.get(userId) ?? IDLE_REQUEST), ...patch }),
    );
  };

  const change = (member: TeamMember, resourceId: string) => {
    if (!workspaceId) return;
    const activeWorkspaceId = workspaceId;
    const { userId } = member;
    const generation = ++requestCount.current;
    latestRequestByMember.current.set(userId, generation);
    const current = () =>
      latestRequestByMember.current.get(userId) === generation &&
      currentWorkspace.current === activeWorkspaceId;
    update(userId, { sending: true, error: null, expectedResourceId: undefined });
    void requestResourceLinkChange(member, workspaceId, resourceId)
      .then((result) => {
        if (!current()) return;
        if (result.kind === 'unknown' || result.kind === 'invalid') {
          update(userId, { error: m.settings_member_resource_unknown() });
        } else if (result.kind === 'rejected') {
          update(userId, {
            error: resolveRejectionMessage(result, m.settings_member_resource_error()),
          });
        } else update(userId, { expectedResourceId: resourceId === '' ? null : resourceId });
        if (result.kind !== 'rejected') invalidateResourceAvatars();
      })
      .catch((cause: unknown) => {
        console.warn('Resource link request failed', cause);
        if (current()) {
          update(userId, { error: m.settings_member_resource_unknown() });
          invalidateResourceAvatars();
        }
      })
      .finally(() => {
        if (current()) update(userId, { sending: false, requiredReadGeneration: reload() });
      });
  };

  return (member) => {
    const request = requests.get(member.userId) ?? IDLE_REQUEST;
    const pending = request.sending || acceptedReadGeneration < request.requiredReadGeneration;
    const reconciled =
      !pending && (member.resourceLink?.resourceId ?? null) === request.expectedResourceId;
    return {
      pending,
      error: request.error,
      statusMessage: resolveResourceStatus({
        expectedResourceId: request.expectedResourceId,
        reconciled,
      }),
      change: (resourceId) => change(member, resourceId),
      // A finished success is announced once; errors and unknown outcomes stay until the next
      // change. While the change is pending, keep it so a reopened dialog announces completion.
      clearStatus: () => {
        if (!pending) update(member.userId, { expectedResourceId: undefined });
      },
    };
  };
}
