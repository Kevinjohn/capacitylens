import { API_BASE } from "../data/apiConfig";
import { apiFetch } from "../data/requestTimeout";
import type { BrowserAccountCommand } from "./accountCommands";
import { buildCommandRequestInit, runCommand } from "./commandRequest";

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

/** Send a link or change command through the account command boundary. */
export function setMemberResourceLink(
  input: MemberResourceLinkRequestInput,
  command?: BrowserAccountCommand,
): Promise<Response> {
  return runCommand({
    operationKey:
      `member-resource-link:${input.workspaceId}:${input.principalId}:` +
      `${input.resourceId}:${input.expectedRevision ?? "none"}`,
    explicit: command,
    request: (resolved) => {
      const [url, init] = memberResourceLinkRequest(input);
      return apiFetch(url, buildCommandRequestInit(init, resolved));
    },
    ambiguousStatus: 409,
  });
}

/** Build a link-change request for the member-resource command adapter. */
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

/** Build an unlink request for the member-resource command adapter. */
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

/** Send an unlink command through the account command boundary. */
export function clearMemberResourceLink(
  input: { workspaceId: string; principalId: string; expectedRevision: string },
  command?: BrowserAccountCommand,
): Promise<Response> {
  return runCommand({
    operationKey: `member-resource-unlink:${input.workspaceId}:${input.principalId}:${input.expectedRevision}`,
    explicit: command,
    request: (resolved) => {
      const [url, init] = clearMemberResourceLinkRequest(input.workspaceId, input.principalId, input.expectedRevision);
      return apiFetch(url, buildCommandRequestInit(init, resolved));
    },
    ambiguousStatus: 409,
  });
}

/** Dismiss one current member/person link exception through the account command boundary. */
export function dismissMemberResourceLinkException(
  workspaceId: string,
  principalId: string,
  command?: BrowserAccountCommand,
): Promise<Response> {
  return runCommand({
    operationKey: `resource-link-exception-dismiss:${workspaceId}:${principalId}`,
    explicit: command,
    request: (resolved) =>
      apiFetch(
        `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}/resource-link-exception`,
        buildCommandRequestInit({ method: "DELETE", credentials: "include" }, resolved),
      ),
  });
}
