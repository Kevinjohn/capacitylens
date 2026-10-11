import { defineMigration } from "../migrationLedger";

/**
 * Adds the browser hash column and lookup index used to bind Microsoft proof to its starting browser.
 */
export const MICROSOFT_JOIN_BROWSER_V51_SQL = `
ALTER TABLE microsoft_identity_proofs ADD COLUMN browserHash TEXT;
CREATE INDEX idx_microsoft_identity_proofs_browser ON microsoft_identity_proofs(browserHash, createdAt);
`;

/**
 * Adds the version 51 migration that binds Microsoft company-joining proof to a browser.
 */
export const MICROSOFT_JOIN_BROWSER_V51_MIGRATION = defineMigration(
  51,
  "bind-microsoft-company-joining-browser",
  MICROSOFT_JOIN_BROWSER_V51_SQL,
  (db) => db.exec(MICROSOFT_JOIN_BROWSER_V51_SQL),
);
