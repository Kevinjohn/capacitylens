import { API_BASE } from "../data/apiConfig";

/** Build the account-owned URL for the minimum scheduled-person avatar projection. */
export function resourceAvatarsUrl(workspaceId: string): string {
  return `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/resource-avatars`;
}

/** Build the account-owned URL for one member/person association. */
export function memberResourceLinkUrl(workspaceId: string, principalId: string): string {
  return `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}/resource-link`;
}

export interface MemberResourceLinkRequestInput {
  workspaceId: string;
  principalId: string;
  resourceId: string;
  expectedRevision: string | null;
}

/** Build a link-change request while leaving executable transport ownership in accountClient. */
export function memberResourceLinkRequest(input: MemberResourceLinkRequestInput): [string, RequestInit] {
  return [
    memberResourceLinkUrl(input.workspaceId, input.principalId),
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceId: input.resourceId, expectedRevision: input.expectedRevision }),
    },
  ];
}

/** Build an unlink request while leaving executable transport ownership in accountClient. */
export function clearMemberResourceLinkRequest(
  workspaceId: string,
  principalId: string,
  expectedRevision: string,
): [string, RequestInit] {
  return [
    memberResourceLinkUrl(workspaceId, principalId),
    {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision }),
    },
  ];
}
