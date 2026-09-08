import type { InvitationRole, MembershipStatus } from "@capacitylens/shared/account/types";
import { isAccountRole, isMembershipStatus } from "@capacitylens/shared/account/types";
import type { Role } from "@capacitylens/shared/domain/access";
import { accountClient, readUnknownAccountCommandOutcome } from "./accountClient";
import { hasDuplicateIdentity } from "../lib/hasDuplicateIdentity";
import { isIsoInstant } from "@capacitylens/shared/account/types";
import { extractApiErrorMessage, readApiError } from "../lib/readApiError";

export interface TeamMember {
  userId: string;
  role: Role;
  status: MembershipStatus;
  createdAt: string;
  name: string | null;
  email: string | null;
  /** Coarse, account-opted-in observation. Null means tracking is off; no timestamp is collected. */
  signInConfirmed: boolean | null;
  isSelf: boolean;
  mayResetPassword: boolean;
  mayRevokeSessions: boolean;
}

export interface TeamDirectory {
  members: TeamMember[];
  signInTrackingEnabled: boolean;
}

export interface TeamInvitation {
  id: string;
  role: InvitationRole;
  preauthEmail: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface OneTimeToken {
  id?: string;
  token: string;
  expiresAt?: string;
}

export type TeamAccessResult<T> =
  | { kind: "ok"; status: number; value: T }
  | { kind: "rejected"; status: number; message: string | null }
  | { kind: "unknown"; status: number; message: string | null }
  | { kind: "invalid"; status: number; message: string };

/**
 * The sentence to show a user for a non-ok {@link TeamAccessResult}: the SERVER's own message when a
 * rejection carried one, otherwise the caller's per-operation fallback.
 *
 * Only `kind: 'rejected'` is server-authored refusal ("that member is the last owner"), so only that
 * kind's message is preferred. `unknown` (the write may or may not have landed) and `invalid` (we
 * could not decode the body) carry messages that describe OUR uncertainty, not the user's problem,
 * and the caller's fallback stays the better sentence for them — which is exactly what every Team &
 * access call site already open-codes. An empty-string message falls back too: a blank toast is a
 * worse outcome than a generic one.
 *
 * @param result   - the outcome returned by any {@link teamAccessClient} method.
 * @param fallback - the caller's own operation-specific sentence, already localised.
 * @returns the message to surface; never empty as long as `fallback` isn't.
 */
export function resolveRejectionMessage<T>(result: TeamAccessResult<T>, fallback: string): string {
  return result.kind === "rejected" && result.message ? result.message : fallback;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const isTimestamp = isIsoInstant;

const isNullableString = (value: unknown): value is string | null => value === null || typeof value === "string";

const isOptionalBoolean = (value: unknown): value is boolean | undefined =>
  value === undefined || typeof value === "boolean";

const isOptionalNullableBoolean = (value: unknown): value is boolean | null | undefined =>
  value === undefined || value === null || typeof value === "boolean";

function hasValidMemberIdentity(
  row: Record<string, unknown>,
): row is Record<string, unknown> & Pick<TeamMember, "userId" | "role" | "status" | "createdAt"> {
  return (
    typeof row.userId === "string" &&
    row.userId.length > 0 &&
    isAccountRole(row.role) &&
    isMembershipStatus(row.status) &&
    isTimestamp(row.createdAt)
  );
}

function hasValidMemberAccess(
  row: Record<string, unknown>,
): row is Record<string, unknown> & Pick<TeamMember, "isSelf"> {
  return (
    typeof row.isSelf === "boolean" &&
    isOptionalNullableBoolean(row.signInConfirmed) &&
    isOptionalBoolean(row.mayResetPassword) &&
    isOptionalBoolean(row.mayRevokeSessions)
  );
}

function parseMember(row: unknown): TeamMember | null {
  if (!isRecord(row)) return null;
  if (!hasValidMemberIdentity(row)) return null;
  if (!hasValidMemberAccess(row)) return null;
  if (!isNullableString(row.name) || !isNullableString(row.email)) return null;
  return {
    userId: row.userId,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt,
    name: row.name,
    email: row.email,
    signInConfirmed: typeof row.signInConfirmed === "boolean" ? row.signInConfirmed : null,
    isSelf: row.isSelf,
    mayResetPassword: row.mayResetPassword === true,
    mayRevokeSessions: row.mayRevokeSessions === true,
  };
}

function parseMembers(value: unknown): TeamDirectory | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.members) ||
    !(value.signInTrackingEnabled === undefined || typeof value.signInTrackingEnabled === "boolean")
  )
    return null;
  const signInTrackingEnabled = value.signInTrackingEnabled === true;
  const members: TeamMember[] = [];
  for (const row of value.members) {
    const member = parseMember(row);
    if (member === null) {
      console.warn("teamAccessClient: dropped an unsupported member-directory row", row);
      continue;
    }
    members.push(member);
  }
  if (value.members.length > 0 && members.length === 0) return null;
  return hasDuplicateIdentity(members, (member) => member.userId) ? null : { members, signInTrackingEnabled };
}

function hasValidInvitationIdentity(
  row: Record<string, unknown>,
): row is Record<string, unknown> & Pick<TeamInvitation, "id" | "role"> {
  return typeof row.id === "string" && row.id.length > 0 && isAccountRole(row.role) && row.role !== "owner";
}

function hasValidInvitationDates(
  row: Record<string, unknown>,
): row is Record<string, unknown> & Pick<TeamInvitation, "expiresAt" | "usedAt" | "createdAt"> {
  return isTimestamp(row.expiresAt) && (row.usedAt === null || isTimestamp(row.usedAt)) && isTimestamp(row.createdAt);
}

function parseInvitation(row: unknown): TeamInvitation | null {
  if (!isRecord(row)) return null;
  if (!hasValidInvitationIdentity(row)) return null;
  if (!hasValidInvitationDates(row)) return null;
  if (!(row.preauthEmail === undefined || row.preauthEmail === null || typeof row.preauthEmail === "string"))
    return null;
  return {
    id: row.id,
    role: row.role,
    preauthEmail: typeof row.preauthEmail === "string" ? row.preauthEmail : null,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}

function parseInvitations(value: unknown): TeamInvitation[] | null {
  if (!isRecord(value) || !Array.isArray(value.invites)) return null;
  const invitations: TeamInvitation[] = [];
  for (const row of value.invites) {
    const invitation = parseInvitation(row);
    if (invitation === null) {
      console.warn("teamAccessClient: dropped an unsupported invitation-directory row", row);
      continue;
    }
    invitations.push(invitation);
  }
  if (value.invites.length > 0 && invitations.length === 0) return null;
  return hasDuplicateIdentity(invitations, (invitation) => invitation.id) ? null : invitations;
}

function hasUnsafeTokenCharacter(token: string): boolean {
  return Array.from(token).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return /\s/u.test(character) || codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function hasValidOptionalTokenFields(
  value: Record<string, unknown>,
): value is Record<string, unknown> & Pick<OneTimeToken, "id" | "expiresAt"> {
  const hasValidId = value.id === undefined || (typeof value.id === "string" && value.id.length > 0);
  const hasValidExpiry = value.expiresAt === undefined || isTimestamp(value.expiresAt);
  return hasValidId && hasValidExpiry;
}

function parseToken(value: unknown): OneTimeToken | null {
  if (!isRecord(value) || typeof value.token !== "string") return null;
  // Both current issuers return compact opaque strings. Keep the provider-owned alphabet opaque,
  // but reject values that cannot safely form one write-once URL segment or indicate a skewed body.
  if (value.token.length === 0 || value.token.length > 4_096) return null;
  if (value.token !== value.token.trim() || hasUnsafeTokenCharacter(value.token)) {
    return null;
  }
  if (!hasValidOptionalTokenFields(value)) return null;
  return {
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    token: value.token,
    ...(typeof value.expiresAt === "string" ? { expiresAt: value.expiresAt } : {}),
  };
}

/** Shared by {@link readCommandResult} and {@link readResult}: both treat a decode failure on an ok
 * response the same way, so the success-path decoding lives once. */
async function parseOkBody<T>(response: Response, decode: (body: unknown) => T | null): Promise<TeamAccessResult<T>> {
  const body: unknown = await response.json().catch(() => null);
  const value = decode(body);
  return value === null
    ? {
        kind: "invalid",
        status: response.status,
        message: "The server returned an invalid response.",
      }
    : { kind: "ok", status: response.status, value };
}

async function readCommandResult<T>(
  response: Response,
  decode: (body: unknown) => T | null,
  expectedStatus?: number,
): Promise<TeamAccessResult<T>> {
  if (!response.ok) {
    const clonedMessage = typeof response.clone === "function" ? await readApiError(response) : undefined;
    const body: unknown = await response.json().catch(() => null);
    const message = clonedMessage ?? extractApiErrorMessage(body) ?? null;
    return (await readUnknownAccountCommandOutcome(response, body))
      ? { kind: "unknown", status: response.status, message }
      : { kind: "rejected", status: response.status, message };
  }
  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    console.warn(
      `teamAccessClient: expected status ${expectedStatus} but received equivalent success ${response.status}; decoding the response body.`,
    );
  }
  return parseOkBody(response, decode);
}

async function readResult<T>(response: Response, decode: (body: unknown) => T | null): Promise<TeamAccessResult<T>> {
  if (!response.ok) {
    return {
      kind: "rejected",
      status: response.status,
      message: (await readApiError(response)) ?? null,
    };
  }
  return parseOkBody(response, decode);
}

const noContent = (): true => true;

/** Typed account-administration boundary. Raw Response handling and untrusted payload codecs stay
 * here; the Team & access controller consumes semantic outcomes only. */
export const teamAccessClient = {
  async listMembers(workspaceId: string): Promise<TeamAccessResult<TeamDirectory>> {
    return readResult(await accountClient.listMembers(workspaceId), parseMembers);
  },

  async setMemberSignInTracking(workspaceId: string, enabled: boolean): Promise<TeamAccessResult<boolean>> {
    return readResult(await accountClient.setMemberSignInTracking(workspaceId, enabled), (body) =>
      isRecord(body) && typeof body.enabled === "boolean" ? body.enabled : null,
    );
  },

  async listInvitations(workspaceId: string): Promise<TeamAccessResult<TeamInvitation[]>> {
    return readResult(await accountClient.listInvitations(workspaceId), parseInvitations);
  },

  async changeMemberRole(workspaceId: string, principalId: string, role: Role): Promise<TeamAccessResult<true>> {
    return readCommandResult(
      await accountClient.changeMemberRole({ workspaceId: workspaceId, principalId: principalId, role: role }),
      noContent,
    );
  },

  async changeMemberStatus(
    workspaceId: string,
    principalId: string,
    status: MembershipStatus,
  ): Promise<TeamAccessResult<true>> {
    return readCommandResult(
      await accountClient.changeMemberStatus({ workspaceId: workspaceId, principalId: principalId, status: status }),
      noContent,
    );
  },

  async removeMember(workspaceId: string, principalId: string): Promise<TeamAccessResult<true>> {
    return readCommandResult(await accountClient.removeMember(workspaceId, principalId), noContent);
  },

  async transferOwnership(workspaceId: string, principalId: string): Promise<TeamAccessResult<true>> {
    return readCommandResult(await accountClient.transferOwnership(workspaceId, principalId), noContent);
  },

  async issuePasswordReset(workspaceId: string, principalId: string): Promise<TeamAccessResult<OneTimeToken>> {
    return readCommandResult(await accountClient.issuePasswordReset(workspaceId, principalId), parseToken, 201);
  },

  async revokeMemberSessions(workspaceId: string, principalId: string): Promise<TeamAccessResult<true>> {
    return readCommandResult(await accountClient.revokeMemberSessions(workspaceId, principalId), noContent, 204);
  },

  async createInvitation(input: {
    accountId: string;
    role: InvitationRole;
    preauthEmail?: string;
  }): Promise<TeamAccessResult<OneTimeToken>> {
    return readCommandResult(await accountClient.createInvitation(input), parseToken, 201);
  },

  async revokeInvitation(workspaceId: string, invitationId: string): Promise<TeamAccessResult<true>> {
    return readCommandResult(await accountClient.revokeInvitation(workspaceId, invitationId), noContent);
  },
};
