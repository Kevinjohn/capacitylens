import { canAdministerAccount } from "@capacitylens/shared/account/policy";
import type { ActorContext, Role } from "@capacitylens/shared/account/types";
import { getActiveMemberRole } from "../../controlTables";
import type { Db } from "../../db";
import { getRow } from "../../db";
import { createAccountFailure } from "./failures";

/** Rejects a missing workspace so authorization cannot target an unknown tenant. */
export function assertWorkspaceExists(db: Db, workspaceId: string): { id: string; name: string } {
  const row = getRow(db, "accounts", workspaceId);
  if (!row) throw createAccountFailure("NOT_FOUND", "The workspace does not exist.");
  return { id: String(row.id), name: String(row.name) };
}

/** Requires active membership before an administrative action proceeds. */
export function assertActorRole(db: Db, actor: ActorContext, workspaceId: string): Role {
  const role = getActiveMemberRole(db, workspaceId, actor.principalId);
  if (!role) throw createAccountFailure("NOT_MEMBER", "The actor is not a member of this workspace.");
  return role;
}

interface AssertAccountAuthorityInput {
  db: Db;
  actor: ActorContext;
  workspaceId: string;
  action: Parameters<typeof canAdministerAccount>[1];
  trustedLocal?: boolean | undefined;
}

/** Validates workspace and actor role before accepting an account command. */
export function assertAccountAuthority({
  db,
  actor,
  workspaceId,
  action,
  trustedLocal = false,
}: AssertAccountAuthorityInput): Role {
  assertWorkspaceExists(db, workspaceId);
  if (trustedLocal) return "owner";
  const role = assertActorRole(db, actor, workspaceId);
  if (!canAdministerAccount(role, action)) throw createAccountFailure("FORBIDDEN", "Forbidden.");
  return role;
}

interface AssertAdministrativeAssuranceInput {
  actor: ActorContext;
  trustedLocal: boolean;
  commandId?: string | undefined;
  requireFresh?: boolean;
}

/** Requires fresh session assurance when an action needs reauthentication. */
export function assertAdministrativeAssurance({
  actor,
  trustedLocal,
  commandId,
  requireFresh = true,
}: AssertAdministrativeAssuranceInput): void {
  if (trustedLocal) return;
  if (requireFresh && !actor.fresh) {
    throw createAccountFailure(
      "SESSION_NOT_FRESH",
      "A fresh sign-in is required for this account operation.",
      commandId,
    );
  }
}

interface AssertInvitationAuthorityInput {
  db: Db;
  actor: ActorContext;
  trustedLocal: boolean;
  workspaceId: string;
  commandId: string;
  requireFresh?: boolean | undefined;
}

/**
 * Checks workspace membership, authority, and any required session freshness before invitation commands or replay.
 * Callers opt ordinary administration out of freshness checks with requireFresh: false.
 */
export function assertInvitationAuthority({
  db,
  actor,
  trustedLocal,
  workspaceId,
  commandId,
  requireFresh = true,
}: AssertInvitationAuthorityInput): void {
  assertAdministrativeAssurance({ actor, trustedLocal, commandId, requireFresh });
  assertAccountAuthority({ db, actor, workspaceId, action: "manage-invitations", trustedLocal });
}
