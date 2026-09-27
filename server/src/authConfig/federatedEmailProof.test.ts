import { expect, it } from "vitest";
import { openDb } from "../db";
import { federatedCallbackCapture } from "./captureContexts";
import { createAuthRequestHandler } from "./authRequestHandler";
import {
  captureGoogleEmailProof,
  captureVerifiedFederatedEmailProof,
  ensureFederatedEmailProofGate,
} from "./federatedEmailProof";

function proofDatabase() {
  const db = openDb(":memory:");
  db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT UNIQUE);
    CREATE TABLE account (id TEXT PRIMARY KEY, providerId TEXT, accountId TEXT, userId TEXT);
    INSERT INTO user VALUES ('principal-a', 'alpha@example.test'), ('principal-b', 'beta@example.test');`);
  ensureFederatedEmailProofGate(db);
  return db;
}

it("isolates simultaneous verified Google callbacks and binds proof to matching subjects", async () => {
  const db = proofDatabase();
  try {
    const callback = (subject: string, email: string, principalId: string) =>
      federatedCallbackCapture.run({ active: true, providerId: "google", subject: null, email: null }, async () => {
        captureGoogleEmailProof(db, { sub: subject, email, email_verified: true });
        await Promise.resolve();
        db.prepare(
          `INSERT INTO account (id, providerId, accountId, userId)
          VALUES (?, 'google', ?, ?)`,
        ).run(`link-${principalId}`, subject, principalId);
      });
    await Promise.all([
      callback("subject-a", "alpha@example.test", "principal-a"),
      callback("subject-b", "beta@example.test", "principal-b"),
    ]);
    expect(db.prepare("SELECT principalId, email FROM identity_email_proofs ORDER BY principalId").all()).toEqual([
      { principalId: "principal-a", email: "alpha@example.test" },
      { principalId: "principal-b", email: "beta@example.test" },
    ]);
    expect(() =>
      federatedCallbackCapture.run(
        { active: true, providerId: "google", subject: "subject-a", email: "alpha@example.test" },
        () =>
          db
            .prepare(
              `INSERT INTO account (id, providerId, accountId, userId)
        VALUES ('wrong-link', 'google', 'subject-b', 'principal-a')`,
            )
            .run(),
      ),
    ).toThrow(/federated_email_proof_required/);
  } finally {
    db.close();
  }
});

it("binds GitHub proof to provider, subject, and the selected local address", () => {
  const db = proofDatabase();
  try {
    federatedCallbackCapture.run({ active: true, providerId: "github", subject: null, email: null }, () => {
      captureVerifiedFederatedEmailProof(db, {
        providerId: "github",
        subject: "subject-a",
        email: "alpha@example.test",
        verified: true,
      });
      const insert = (input: { id: string; providerId: string; subject: string; principalId: string }) =>
        db
          .prepare("INSERT INTO account (id, providerId, accountId, userId) VALUES (?, ?, ?, ?)")
          .run(input.id, input.providerId, input.subject, input.principalId);
      expect(() =>
        insert({ id: "wrong-provider", providerId: "google", subject: "subject-a", principalId: "principal-a" }),
      ).toThrow(/federated_email_proof_required/);
      expect(() =>
        insert({ id: "wrong-subject", providerId: "github", subject: "subject-b", principalId: "principal-a" }),
      ).toThrow(/federated_email_proof_required/);
      expect(() =>
        insert({ id: "wrong-email", providerId: "github", subject: "subject-a", principalId: "principal-b" }),
      ).toThrow(/federated_email_proof_required/);
      insert({ id: "right-link", providerId: "github", subject: "subject-a", principalId: "principal-a" });
    });
    expect(db.prepare("SELECT principalId, email, source FROM identity_email_proofs").all()).toEqual([
      { principalId: "principal-a", email: "alpha@example.test", source: "github" },
    ]);
  } finally {
    db.close();
  }
});

it("rolls back a GitHub link that would newly restrict an active Owner", () => {
  const db = proofDatabase();
  try {
    db.prepare(
      "INSERT INTO account_members (accountId, userId, role, status, createdAt) VALUES ('a-studio', 'principal-a', 'owner', 'active', ?)",
    ).run(new Date().toISOString());
    db.prepare(
      "INSERT INTO account_access_restrictions (accountId, principalId, verifiedEmail, role, createdAt) VALUES ('a-studio', 'erased-id', 'alpha@example.test', 'editor', ?)",
    ).run(new Date().toISOString());
    expect(() =>
      federatedCallbackCapture.run({ active: true, providerId: "github", subject: null, email: null }, () => {
        captureVerifiedFederatedEmailProof(db, {
          providerId: "github",
          subject: "subject-a",
          email: "alpha@example.test",
          verified: true,
        });
        db.prepare(
          "INSERT INTO account (id, providerId, accountId, userId) VALUES ('owner-link', 'github', 'subject-a', 'principal-a')",
        ).run();
      }),
    ).toThrow(/federated_email_proof_owner_conflict/);
    expect(db.prepare("SELECT id FROM account").all()).toEqual([]);
    expect(db.prepare("SELECT principalId FROM identity_email_proofs").all()).toEqual([]);
  } finally {
    db.close();
  }
});

it.each([
  ["google", false],
  ["google", true],
  ["github", false],
  ["github", true],
] as const)("clears %s callback facts after completion or failure (%s)", async (providerId, fail) => {
  const db = proofDatabase();
  try {
    let captured: ReturnType<typeof federatedCallbackCapture.getStore>;
    const handler = createAuthRequestHandler({
      rawHandler: async () => {
        captureVerifiedFederatedEmailProof(db, {
          providerId,
          subject: "subject-a",
          email: "alpha@example.test",
          verified: true,
        });
        captured = federatedCallbackCapture.getStore();
        if (fail) throw new Error("callback failed");
        return new Response(null, { status: 302, headers: { location: "http://localhost/" } });
      },
      providerIdFromExternalContext: () => providerId,
      callbackErrorUrl: () => new URL("http://localhost/error"),
      browserAuthErrorUrl: new URL("http://localhost/error"),
      commitResetSessions: () => {},
      reconcileFederatedLinks: () => {},
      microsoftProof: null,
    });
    const request = new Request(`http://localhost/api/auth/callback/${providerId}`);
    if (fail) await expect(handler(request)).rejects.toThrow("callback failed");
    else expect((await handler(request)).status).toBe(302);
    expect(captured?.active).toBe(false);
    expect(captured?.email).toBeNull();
    expect(captured?.subject).toBeNull();
  } finally {
    db.close();
  }
});
