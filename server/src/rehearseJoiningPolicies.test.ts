import { DatabaseSync } from "node:sqlite";
import { isApprovedEmailDomain } from "@capacitylens/shared/account/approvedDomains";
import { describe, expect, it } from "vitest";
import { anonymise } from "../scripts/rehearse/anonymise";

function joiningPolicyDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY);
    CREATE TABLE account_joining_policies (
      accountId TEXT PRIMARY KEY, policy TEXT NOT NULL, approvedDomains TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE);
    CREATE TABLE identity_email_proofs (principalId TEXT PRIMARY KEY, email TEXT, source TEXT, provenAt TEXT);
    CREATE TABLE account_access_restrictions
      (accountId TEXT, principalId TEXT, verifiedEmail TEXT, role TEXT, createdAt TEXT);
    CREATE TABLE invites (id TEXT PRIMARY KEY, preauthEmail TEXT);
    INSERT INTO accounts VALUES ('source-company');
    INSERT INTO account_joining_policies VALUES
      ('source-company', 'approved_domains', '["BÜCHER.example","corp.example"]', '2026-01-01');
    INSERT INTO user VALUES
      ('member-one', 'member@BÜCHER.example'),
      ('member-two', 'Member@xn--bcher-kva.example'),
      ('outsider', 'outsider@third.example');
    INSERT INTO identity_email_proofs VALUES
      ('member-one', 'member@xn--bcher-kva.example', 'google', '2026-01-01'),
      ('member-two', 'MEMBER@bücher.example', 'google', '2026-01-02'),
      ('outsider', 'outsider@third.example', 'google', '2026-01-03');
    INSERT INTO account_access_restrictions VALUES
      ('source-company', 'removed-member', 'member@BÜCHER.example', 'editor', '2026-01-01');
    INSERT INTO invites VALUES ('invite-one', 'MEMBER@xn--bcher-kva.example');
  `);
  return db;
}

describe("joining policy rehearsal redaction", () => {
  // eslint-disable-next-line complexity -- one fixture verifies shared aliases across each retained address surface.
  it("keeps approved-domain eligibility and equivalent identity addresses after anonymisation", () => {
    const db = joiningPolicyDatabase();
    try {
      anonymise(db);

      const policy = db.prepare("SELECT approvedDomains FROM account_joining_policies").get() as {
        approvedDomains: string;
      };
      const approvedDomains = JSON.parse(policy.approvedDomains) as string[];
      const users = db.prepare("SELECT id, email FROM user ORDER BY id").all() as Array<{
        id: string;
        email: string;
      }>;
      const proofs = db
        .prepare("SELECT principalId, email FROM identity_email_proofs ORDER BY principalId")
        .all() as Array<{
        principalId: string;
        email: string;
      }>;
      const restriction = db.prepare("SELECT verifiedEmail FROM account_access_restrictions").get() as {
        verifiedEmail: string;
      };
      const invitation = db.prepare("SELECT preauthEmail FROM invites").get() as { preauthEmail: string };
      const memberEmails = [
        users[0]?.email,
        users[1]?.email,
        proofs[0]?.email,
        proofs[1]?.email,
        restriction.verifiedEmail,
        invitation.preauthEmail,
      ];

      expect(approvedDomains).toHaveLength(2);
      expect(JSON.stringify({ approvedDomains, users, proofs, restriction, invitation })).not.toMatch(
        /bücher|xn--bcher-kva|corp\.example|third\.example/i,
      );
      expect(users[0]?.email.toLowerCase()).toBe(users[1]?.email.toLowerCase());
      expect(new Set(memberEmails.map((email) => email?.toLowerCase())).size).toBe(1);
      for (const email of [
        users[0]?.email,
        users[1]?.email,
        proofs[0]?.email,
        proofs[1]?.email,
        restriction.verifiedEmail,
      ]) {
        expect(isApprovedEmailDomain(email ?? "", approvedDomains)).toBe(true);
      }
      expect(isApprovedEmailDomain(users[2]?.email ?? "", approvedDomains)).toBe(false);
    } finally {
      db.close();
    }
  });
});
