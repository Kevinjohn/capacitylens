import { defineMigration } from "../migrationLedger";

export const IDENTITY_EMAIL_PROOF_V48_SQL = `
CREATE TABLE identity_email_proofs (
  principalId TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('google', 'microsoft', 'password')),
  provenAt TEXT NOT NULL
);
CREATE INDEX idx_identity_email_proofs_email ON identity_email_proofs(email);
`;

export const IDENTITY_EMAIL_PROOF_V48_MIGRATION = defineMigration(
  48,
  "record-identity-email-proof",
  IDENTITY_EMAIL_PROOF_V48_SQL,
  (db) => db.exec(IDENTITY_EMAIL_PROOF_V48_SQL),
);
