import { fetchApi } from '@/data/requestTimeout';
import { buildApiRouteUrl, buildJsonBody } from '@/api/queryClient';

/** Build the account-owned URL for one member/person association. */
export function buildMemberResourceLinkUrl(companyId: string, userId: string): string {
  return buildApiRouteUrl('api.member_resource_links.update', {
    params: { companyId, userId },
  });
}

/** Identifies the company member and resource for a resource-link request. */
export interface MemberResourceLinkRequestInput {
  companyId: string;
  userId: string;
  resourceId: string;
  expectedRevision: string | null;
}

/** Send a link or change operation. */
export function setMemberResourceLink(input: MemberResourceLinkRequestInput): Promise<Response> {
  return fetchApi(...buildMemberResourceLinkRequest(input));
}

/** Build a link-change request for the member-resource operation adapter. */
export function buildMemberResourceLinkRequest(
  input: MemberResourceLinkRequestInput,
): [string, RequestInit] {
  return [
    buildMemberResourceLinkUrl(input.companyId, input.userId),
    {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: buildJsonBody('api.member_resource_links.update', {
        resourceId: input.resourceId,
        expectedRevision: input.expectedRevision,
      }),
    },
  ];
}

/** Build an unlink request for the member-resource operation adapter. */
export function clearMemberResourceLinkRequest(
  companyId: string,
  userId: string,
  expectedRevision: string,
): [string, RequestInit] {
  return [
    buildMemberResourceLinkUrl(companyId, userId),
    {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: buildJsonBody('api.member_resource_links.destroy', { expectedRevision }),
    },
  ];
}

/** Send an unlink operation. */
export function clearMemberResourceLink(input: {
  companyId: string;
  userId: string;
  expectedRevision: string;
}): Promise<Response> {
  return fetchApi(
    ...clearMemberResourceLinkRequest(input.companyId, input.userId, input.expectedRevision),
  );
}
