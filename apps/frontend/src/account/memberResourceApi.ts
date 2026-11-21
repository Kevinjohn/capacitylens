import { fetchApi } from '@/data/requestTimeout';
import { buildApiRouteUrl, buildJsonBody } from '@/api/queryClient';
import type { BrowserAccountOperation } from './accountOperations';
import { buildOperationRequestInit, runOperation } from './operationRequest';

/** Build the account-owned URL for one member/person association. */
export function buildMemberResourceLinkUrl(companyId: string, principalId: string): string {
  return buildApiRouteUrl('api.member-resources.set', {
    params: { companyId, userId: principalId },
  });
}

/** Identifies the company member and resource for a resource-link request. */
export interface MemberResourceLinkRequestInput {
  companyId: string;
  principalId: string;
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
      `member-resource-link:${input.companyId}:${input.principalId}:` +
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
    buildMemberResourceLinkUrl(input.companyId, input.principalId),
    {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: buildJsonBody('api.member-resources.set', {
        resourceId: input.resourceId,
        expectedRevision: input.expectedRevision,
      }),
    },
  ];
}

/** Build an unlink request for the member-resource operation adapter. */
export function clearMemberResourceLinkRequest(
  companyId: string,
  principalId: string,
  expectedRevision: string,
): [string, RequestInit] {
  return [
    buildMemberResourceLinkUrl(companyId, principalId),
    {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: buildJsonBody('api.member-resources.clear', { expectedRevision }),
    },
  ];
}

/** Send an unlink operation through the account operation boundary. */
export function clearMemberResourceLink(
  input: { companyId: string; principalId: string; expectedRevision: string },
  operation?: BrowserAccountOperation,
): Promise<Response> {
  return runOperation({
    operationKey: `member-resource-unlink:${input.companyId}:${input.principalId}:${input.expectedRevision}`,
    explicit: operation,
    request: (resolved) => {
      const [url, init] = clearMemberResourceLinkRequest(
        input.companyId,
        input.principalId,
        input.expectedRevision,
      );
      return fetchApi(url, buildOperationRequestInit(init, resolved));
    },
    ambiguousStatus: 409,
  });
}
