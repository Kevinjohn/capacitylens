import { defineMigration } from "../migrationLedger";

export const JOINING_POLICIES_V49_SQL = `
CREATE TABLE account_joining_policies (
  accountId TEXT PRIMARY KEY,
  policy TEXT NOT NULL CHECK (policy IN ('invitation_only', 'open', 'approved_domains', 'approved_domains_or_invitation')),
  approvedDomains TEXT NOT NULL DEFAULT '[]',
  updatedAt TEXT NOT NULL
);
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
