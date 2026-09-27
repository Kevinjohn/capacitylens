import { defineMigration } from "../migrationLedger";

export const MICROSOFT_JOIN_BROWSER_V51_SQL = `
ALTER TABLE microsoft_identity_proofs ADD COLUMN browserHash TEXT;
CREATE INDEX idx_microsoft_identity_proofs_browser ON microsoft_identity_proofs(browserHash, createdAt);
`;

export const MICROSOFT_JOIN_BROWSER_V51_MIGRATION = defineMigration(
  51,
  "bind-microsoft-company-joining-browser",
  MICROSOFT_JOIN_BROWSER_V51_SQL,
  (db) => db.exec(MICROSOFT_JOIN_BROWSER_V51_SQL),
);
