import type { Db } from "../db";
import { getInvite } from "../controlTables/invites";

/** Invitation facts needed by identity proof, without exposing the bearer or row contract. */
export function resolveProofInvitation(db: Db, token: string) {
  const invite = getInvite(db, token);
  if (!invite?.preauthEmail || invite.usedAt || Date.parse(invite.expiresAt) <= Date.now()) return null;
  return { id: invite.id, accountId: invite.accountId, preauthEmail: invite.preauthEmail };
}

/** Recheck the exact invitation immediately before proof approval or account creation. */
export function hasLiveProofInvitation(
  db: Db,
  input: {
    inviteId: string | null;
    accountId: string | null;
    targetEmail: string;
  },
): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM invites
       WHERE id = ? AND accountId = ? AND preauthEmail = ?
         AND usedAt IS NULL AND expiresAt > ?`,
      )
      .get(input.inviteId, input.accountId, input.targetEmail, new Date().toISOString()),
  );
}
