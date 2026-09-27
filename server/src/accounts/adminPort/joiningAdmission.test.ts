import { describe, expect, it } from "vitest";
import { createInvite, disableAccess, getInvite, upsertMember } from "../../controlTables";
import { writeJoiningPolicy } from "../../controlTables/joiningPolicies";
import { insertRow, openDb } from "../../db";
import { tx } from "../../txn";
import { admitCompanyInTx } from "./joiningAdmission";
import { createJoiningProviderIntent } from "./joiningProviderIntent";
import { createJoiningProviderCallbacks } from "./joiningProviderCallbacks";

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
  db.prepare(
    "INSERT INTO identity_email_proofs (principalId, email, source, provenAt) VALUES (?, ?, 'password', ?)",
  ).run("diana", "diana@studio.example", "2026-01-01T00:00:00.000Z");
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
      applicationId: "capacitylens",
      admissionId: `test-${purpose}`,
      confirmedSignIn: true,
      accountId: "a-studio",
      principalId: "diana",
      email: "diana@studio.example",
      purpose,
      ...(purpose === "invitation" ? { invitationToken: "invite-token" } : {}),
      now: Date.parse("2026-09-27T00:00:00.000Z"),
    }),
  );

// eslint-disable-next-line max-lines-per-function -- These cases exercise the same admission transaction fixture.
describe("company admission transaction", () => {
  it("cannot substitute another invitation after a provider intent is approved", async () => {
    const db = fixture();
    try {
      invite(db, "viewer");
      createInvite(db, {
        token: "admin-token",
        id: "invite-2",
        accountId: "a-studio",
        role: "admin",
        preauthEmail: "diana@studio.example",
        expiresAt: "2027-01-01T00:00:00.000Z",
        usedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const options = { db, applicationId: "capacitylens", secret: "x".repeat(32), secureCookies: false };
      const started = await createJoiningProviderIntent(options).start({
        accountId: "a-studio",
        purpose: "invitation",
        invitationToken: "invite-token",
        email: "diana@studio.example",
        providerId: "google",
        headers: new Headers(),
        sourceIp: "127.0.0.1",
        publicUrl: new URL("http://localhost:8787"),
        startOAuth: async () => ({ url: "https://accounts.google.com/?state=example-state", setCookies: [] }),
      });
      const headers = new Headers({ cookie: started.setCookies.map((value) => value.split(";", 1)[0]).join("; ") });
      db.prepare("UPDATE company_join_intents SET state = 'approved', principalId = 'diana'").run();
      const callbacks = createJoiningProviderCallbacks(options);
      const actor = {
        principalId: "diana",
        sessionId: "diana-session",
        assurance: "federated",
        fresh: false,
        mfaSatisfied: true,
      } as const;
      expect(() =>
        callbacks.complete({ headers, actor, providerId: "google", invitationToken: "admin-token", requireMfa: false }),
      ).toThrow();
      expect(getInvite(db, "admin-token")?.usedAt).toBeNull();
      expect(
        callbacks.complete({
          headers,
          actor,
          providerId: "google",
          invitationToken: "invite-token",
          requireMfa: false,
        }),
      ).toMatchObject({ role: "viewer" });
    } finally {
      db.close();
    }
  });
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

  it("preserves an active elevated role when a lower-role invitation is accepted", () => {
    const db = fixture();
    try {
      invite(db, "viewer");
      upsertMember(db, {
        accountId: "a-studio",
        userId: "diana",
        role: "admin",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      expect(admit(db, "invitation")).toMatchObject({ role: "admin", status: "active" });
      expect(getInvite(db, "invite-token")?.usedAt).not.toBeNull();
    } finally {
      db.close();
    }
  });

  it("records invitation acceptance and sign-in tracking in the admission transaction", () => {
    const db = fixture();
    try {
      invite(db);
      db.prepare("INSERT INTO account_member_sign_in_tracking (accountId) VALUES (?)").run("a-studio");
      expect(admit(db, "invitation")).toMatchObject({ role: "editor" });
      expect(db.prepare("SELECT signInConfirmed FROM account_members WHERE userId = 'diana'").get()).toEqual({
        signInConfirmed: "true",
      });
      expect(
        db.prepare("SELECT json_extract(payload, '$.action') AS action FROM capacitylens_audit_outbox").get(),
      ).toEqual({ action: "invitation.accepted" });
    } finally {
      db.close();
    }
  });

  it("rolls back membership and invitation consumption if the audit cannot be recorded", () => {
    const db = fixture();
    try {
      invite(db);
      db.prepare(`INSERT INTO capacitylens_audit_outbox (id, payload, createdAt) VALUES (?, '{}', ?)`).run(
        "test-invitation:invitation.accepted:success",
        "2026-01-01T00:00:00.000Z",
      );
      expect(() => admit(db, "invitation")).toThrow();
      expect(db.prepare("SELECT 1 FROM account_members WHERE userId = 'diana'").get()).toBeUndefined();
      expect(getInvite(db, "invite-token")?.usedAt).toBeNull();
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
