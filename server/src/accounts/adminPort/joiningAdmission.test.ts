import { describe, expect, it } from "vitest";
import { createInvite, disableAccess, getInvite, upsertMember } from "../../controlTables";
import { writeJoiningPolicy } from "../../controlTables/joiningPolicies";
import { insertRow, openDb } from "../../db";
import { tx } from "../../txn";
import { admitCompanyInTx } from "./joiningAdmission";

function fixture() {
  const db = openDb(":memory:");
  insertRow(db, "accounts", {
    id: "a-studio",
    name: "Wayne Enterprises",
    color: "#6366f1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  db.exec("CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL)");
  db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run("diana", "diana@studio.example");
  db.prepare("INSERT INTO identity_email_proofs (principalId, email, source, provenAt) VALUES (?, ?, 'password', ?)").run(
    "diana",
    "diana@studio.example",
    "2026-01-01T00:00:00.000Z",
  );
  return db;
}

function invite(db: ReturnType<typeof fixture>, role: "viewer" | "editor" = "editor") {
  createInvite(db, {
    token: "invite-token",
    id: "invite-1",
    accountId: "a-studio",
    role,
    preauthEmail: "diana@studio.example",
    expiresAt: "2027-01-01T00:00:00.000Z",
    usedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

const admit = (db: ReturnType<typeof fixture>, purpose: "policy" | "invitation") =>
  tx(db, () =>
    admitCompanyInTx({
      db,
      accountId: "a-studio",
      principalId: "diana",
      email: "diana@studio.example",
      purpose,
      ...(purpose === "invitation" ? { invitationToken: "invite-token" } : {}),
      now: Date.parse("2026-09-27T00:00:00.000Z"),
    }),
  );

describe("company admission transaction", () => {
  it("applies each policy and assigns Viewer to a direct join", () => {
    for (const policy of ["invitation_only", "open", "approved_domains", "approved_domains_or_invitation"] as const) {
      const db = fixture();
      try {
        writeJoiningPolicy(db, "a-studio", { policy, approvedDomains: ["studio.example"] });
        if (policy === "invitation_only") {
          expect(() => admit(db, "policy")).toThrow();
        } else {
          expect(admit(db, "policy")).toMatchObject({ role: "viewer", status: "active" });
        }
      } finally {
        db.close();
      }
    }
  });

  it("uses the invitation role for an inactive member but keeps an active role", () => {
    const db = fixture();
    try {
      invite(db);
      upsertMember(db, {
        accountId: "a-studio",
        userId: "diana",
        role: "viewer",
        status: "archived",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      expect(admit(db, "invitation")).toMatchObject({ role: "editor", status: "active" });
      expect(getInvite(db, "invite-token")?.usedAt).not.toBeNull();
    } finally {
      db.close();
    }
  });

  it("rechecks domain policy and Disable Access without consuming an invitation", () => {
    const db = fixture();
    try {
      invite(db);
      writeJoiningPolicy(db, "a-studio", { policy: "approved_domains", approvedDomains: ["other.example"] });
      expect(() => admit(db, "invitation")).toThrow();
      expect(getInvite(db, "invite-token")?.usedAt).toBeNull();
      writeJoiningPolicy(db, "a-studio", { policy: "approved_domains_or_invitation", approvedDomains: [] });
      disableAccess(db, { accountId: "a-studio", principalId: "diana", role: "viewer" });
      expect(() => admit(db, "invitation")).toThrow();
      expect(getInvite(db, "invite-token")?.usedAt).toBeNull();
    } finally {
      db.close();
    }
  });
});
