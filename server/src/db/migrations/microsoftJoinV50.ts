import { defineMigration } from "../migrationLedger";

// SQLite cannot alter a CHECK constraint in place. Rebuild only the proof table; retain all
// outstanding ceremonies and their native OAuth state, then let auth setup reinstall its gates.
export const MICROSOFT_JOIN_V50_SQL = `
DROP TRIGGER IF EXISTS capacitylens_microsoft_account_proof_before;
DROP TRIGGER IF EXISTS capacitylens_microsoft_account_proof_after;
ALTER TABLE microsoft_identity_proofs RENAME TO microsoft_identity_proofs_v46;
CREATE TABLE microsoft_identity_proofs (
  id TEXT PRIMARY KEY,
  nonceHash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('bootstrap', 'invite', 'link', 'join')),
  targetEmail TEXT NOT NULL,
  inviteId TEXT,
  accountId TEXT,
  principalId TEXT,
  sessionId TEXT,
  tenantId TEXT NOT NULL,
  oid TEXT,
  tokenHash TEXT UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('started', 'mail-sent', 'approved', 'completed', 'cancelled')),
  expiresAt INTEGER NOT NULL,
  tokenExpiresAt INTEGER,
  sentCount INTEGER NOT NULL DEFAULT 0,
  lastSentAt INTEGER,
  sourceIpHash TEXT NOT NULL,
  oauthStateHash TEXT UNIQUE,
  oauthStateHistory TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(oauthStateHistory)),
  callbackUrl TEXT NOT NULL,
  errorCallbackUrl TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  CHECK ((purpose = 'invite' AND inviteId IS NOT NULL AND accountId IS NOT NULL AND principalId IS NULL)
      OR (purpose = 'join' AND accountId IS NOT NULL AND principalId IS NULL AND sessionId IS NULL)
      OR (purpose = 'link' AND inviteId IS NULL AND accountId IS NULL AND principalId IS NOT NULL AND sessionId IS NOT NULL)
      OR (purpose = 'bootstrap' AND inviteId IS NULL AND accountId IS NULL AND principalId IS NULL))
);
INSERT INTO microsoft_identity_proofs SELECT * FROM microsoft_identity_proofs_v46;
DROP TABLE microsoft_identity_proofs_v46;
CREATE INDEX idx_microsoft_identity_proofs_address ON microsoft_identity_proofs(targetEmail, createdAt);
CREATE INDEX idx_microsoft_identity_proofs_oid ON microsoft_identity_proofs(oid, createdAt);
CREATE INDEX idx_microsoft_identity_proofs_ip ON microsoft_identity_proofs(sourceIpHash, createdAt);
CREATE UNIQUE INDEX idx_microsoft_identity_proofs_approved_identity
  ON microsoft_identity_proofs(tenantId, oid) WHERE state = 'approved';
`;

export const MICROSOFT_JOIN_V50_MIGRATION = defineMigration(
  50,
  "add-microsoft-company-joining-purpose",
  MICROSOFT_JOIN_V50_SQL,
  (db) => db.exec(MICROSOFT_JOIN_V50_SQL),
);
