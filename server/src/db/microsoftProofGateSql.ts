/** Atomic provider-account insert guard. Identity proof, live invitation and live session facts
 * are checked by SQLite in the same statement that creates the Microsoft provider binding. */
export const MICROSOFT_ACCOUNT_INSERT_GATE = `
CREATE TRIGGER IF NOT EXISTS capacitylens_microsoft_account_proof_before
BEFORE INSERT ON account WHEN NEW.providerId = 'microsoft'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM microsoft_identity_proofs AS proof
    JOIN user AS principal ON principal.id = NEW.userId
    WHERE proof.id = capacitylens_current_microsoft_proof_id()
      AND proof.state = 'approved'
      AND proof.oid = NEW.accountId
      AND proof.targetEmail = lower(principal.email)
      AND proof.expiresAt > CAST(strftime('%s', 'now') AS INTEGER) * 1000
      AND (
        (proof.purpose = 'bootstrap'
          AND (SELECT COUNT(*) FROM user) = 1
          AND EXISTS (SELECT 1 FROM capacitylens_bootstrap_claim WHERE id = 1))
        OR (proof.purpose = 'invite'
          AND EXISTS (
            SELECT 1 FROM invites AS invitation
            JOIN accounts AS workspace ON workspace.id = invitation.accountId
            WHERE invitation.id = proof.inviteId
              AND invitation.accountId = proof.accountId
              AND invitation.preauthEmail = proof.targetEmail
              AND invitation.usedAt IS NULL
              AND CAST(strftime('%s', invitation.expiresAt) AS INTEGER) * 1000 > CAST(strftime('%s', 'now') AS INTEGER) * 1000
          ))
        OR (proof.purpose = 'link'
          AND proof.principalId = NEW.userId
          AND principal.emailVerified = 1
          AND EXISTS (
            SELECT 1 FROM session AS live
            JOIN account_session_assurance AS assurance
              ON assurance.sessionId = capacitylens_microsoft_session_handle(live.token)
            WHERE live.userId = proof.principalId
              AND assurance.sessionId = proof.sessionId
              AND assurance.principalId = proof.principalId
              AND unixepoch(assurance.createdAt) > unixepoch('now') - 900
              AND unixepoch(live.createdAt) > unixepoch('now') - 900
              AND unixepoch(live.expiresAt) > unixepoch('now')
          ))
      )
  ) THEN RAISE(ABORT, 'microsoft_proof_required') END;
END;
CREATE TRIGGER IF NOT EXISTS capacitylens_microsoft_account_proof_after
AFTER INSERT ON account WHEN NEW.providerId = 'microsoft'
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM account_members AS member
    JOIN account_access_restrictions AS restriction ON restriction.accountId = member.accountId
    JOIN microsoft_identity_proofs AS proof ON proof.id = capacitylens_current_microsoft_proof_id()
    WHERE member.userId = NEW.userId AND member.role = 'owner' AND member.status = 'active'
      AND (restriction.principalId = NEW.userId OR restriction.verifiedEmail = proof.targetEmail))
    THEN RAISE(ABORT, 'microsoft_email_proof_owner_conflict') END;
  INSERT INTO identity_email_proofs (principalId, email, source, provenAt)
    SELECT NEW.userId, proof.targetEmail, 'microsoft', strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM microsoft_identity_proofs AS proof
    WHERE proof.id = capacitylens_current_microsoft_proof_id() AND proof.state = 'approved'
      AND proof.oid = NEW.accountId
    ON CONFLICT(principalId) DO UPDATE SET email = excluded.email,
      source = excluded.source, provenAt = excluded.provenAt;
  UPDATE microsoft_identity_proofs
     SET state = 'completed', tokenHash = NULL,
         updatedAt = CAST(strftime('%s', 'now') AS INTEGER) * 1000
   WHERE id = capacitylens_current_microsoft_proof_id()
     AND state = 'approved' AND oid = NEW.accountId;
END;
`;
