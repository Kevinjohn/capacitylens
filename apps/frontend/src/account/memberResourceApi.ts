import { requestApiResponse } from '@/api/queryClient';

/** Identifies the company member and resource for a resource-link request. */
export interface MemberResourceLinkRequestInput {
  companyId: string;
  userId: string;
  resourceId: string;
  expectedRevision: string | null;
}

/** Send a link or change operation. */
export function setMemberResourceLink(input: MemberResourceLinkRequestInput): Promise<Response> {
  return requestApiResponse('api.member_resource_links.update', {
    params: { companyId: input.companyId, userId: input.userId },
    body: { resourceId: input.resourceId, expectedRevision: input.expectedRevision },
  });
}

/** Send an unlink operation. */
export function clearMemberResourceLink(input: {
  companyId: string;
  userId: string;
  expectedRevision: string;
}): Promise<Response> {
  return requestApiResponse('api.member_resource_links.destroy', {
    params: { companyId: input.companyId, userId: input.userId },
    body: { expectedRevision: input.expectedRevision },
  });
}
