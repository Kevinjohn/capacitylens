import { fetchApi } from '@/data/requestTimeout';
import { buildApiRouteUrl, buildJsonBody } from '@/api/queryClient';
import type { BrowserAccountOperation } from './accountOperations';
import { buildOperationRequestInit, runOperation } from './operationRequest';

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

/** Send a link or change operation through the account operation boundary. */
export function setMemberResourceLink(
  input: MemberResourceLinkRequestInput,
  operation?: BrowserAccountOperation,
): Promise<Response> {
  return runOperation({
    operationKey:
      `member-resource-link:${input.companyId}:${input.userId}:` +
      `${input.resourceId}:${input.expectedRevision ?? 'none'}`,
    explicit: operation,
    request: (resolved) => {
      const [url, init] = buildMemberResourceLinkRequest(input);
      return fetchApi(url, buildOperationRequestInit(init, resolved));
    },
    ambiguousStatus: 409,
  });
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

/** Send an unlink operation through the account operation boundary. */
export function clearMemberResourceLink(
  input: { companyId: string; userId: string; expectedRevision: string },
  operation?: BrowserAccountOperation,
): Promise<Response> {
  return runOperation({
    operationKey: `member-resource-unlink:${input.companyId}:${input.userId}:${input.expectedRevision}`,
    explicit: operation,
    request: (resolved) => {
      const [url, init] = clearMemberResourceLinkRequest(
        input.companyId,
        input.userId,
        input.expectedRevision,
      );
      return fetchApi(url, buildOperationRequestInit(init, resolved));
    },
    ambiguousStatus: 409,
  });
}
