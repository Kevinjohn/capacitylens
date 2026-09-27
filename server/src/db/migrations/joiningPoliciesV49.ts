import { defineMigration } from "../migrationLedger";

export const JOINING_POLICIES_V49_SQL = `
CREATE TABLE account_joining_policies (
  accountId TEXT PRIMARY KEY,
  policy TEXT NOT NULL CHECK (policy IN ('invitation_only', 'open', 'approved_domains', 'approved_domains_or_invitation')),
  approvedDomains TEXT NOT NULL DEFAULT '[]',
  updatedAt TEXT NOT NULL
);
CREATE TABLE company_join_intents (
  id TEXT PRIMARY KEY,
  nonceHash TEXT NOT NULL UNIQUE,
  browserHash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('policy', 'invitation')),
  accountId TEXT NOT NULL,
  invitationId TEXT,
  email TEXT NOT NULL,
  principalId TEXT,
  providerId TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('started', 'mail-sent', 'approved', 'completed', 'cancelled')),
  tokenHash TEXT UNIQUE,
  deliveryGeneration INTEGER NOT NULL DEFAULT 0,
  expiresAt INTEGER NOT NULL,
  sentCount INTEGER NOT NULL DEFAULT 0,
  lastSentAt INTEGER,
  sourceIpHash TEXT NOT NULL,
  providerStateHash TEXT UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  CHECK ((purpose = 'policy' AND invitationId IS NULL)
      OR (purpose = 'invitation' AND invitationId IS NOT NULL))
);
CREATE INDEX idx_company_join_intents_email ON company_join_intents(email, lastSentAt);
CREATE INDEX idx_company_join_intents_browser ON company_join_intents(browserHash, lastSentAt);
CREATE INDEX idx_company_join_intents_ip ON company_join_intents(sourceIpHash, lastSentAt);
CREATE INDEX idx_company_join_intents_expiry ON company_join_intents(expiresAt, state);
`;

export const JOINING_POLICIES_V49_MIGRATION = defineMigration(
  49,
  "add-company-joining-policies",
  [JOINING_POLICIES_V49_SQL, "invalidate-unaddressed-invitations-and-proposals:v1"].join(
    "\n-- migration component --\n",
  ),
  (db) => {
    db.exec(JOINING_POLICIES_V49_SQL);
    // Older unaddressed links established no mailbox provenance. They cannot safely authorize
    // admission under the new policy contract, so revoke only unused links on upgrade.
    db.prepare(
      `DELETE FROM invitation_person_proposals WHERE invitationId IN
      (SELECT id FROM invites WHERE preauthEmail IS NULL AND usedAt IS NULL)`,
    ).run();
    db.prepare("DELETE FROM invites WHERE preauthEmail IS NULL AND usedAt IS NULL").run();
  },
);
