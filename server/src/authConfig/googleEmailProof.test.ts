import { expect, it } from "vitest";
import { openDb } from "../db";
import { googleCallbackCapture } from "./captureContexts";
import { createAuthRequestHandler } from "./authRequestHandler";
import { captureGoogleEmailProof, ensureGoogleEmailProofGate } from "./googleEmailProof";

function proofDatabase() {
  const db = openDb(":memory:");
  db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT UNIQUE);
    CREATE TABLE account (id TEXT PRIMARY KEY, providerId TEXT, accountId TEXT, userId TEXT);
    INSERT INTO user VALUES ('principal-a', 'alpha@example.test'), ('principal-b', 'beta@example.test');`);
  ensureGoogleEmailProofGate(db);
  return db;
}

it("isolates simultaneous verified Google callbacks and binds proof to matching subjects", async () => {
  const db = proofDatabase();
  try {
    const callback = (subject: string, email: string, principalId: string) =>
      googleCallbackCapture.run({ active: true, subject: null, email: null }, async () => {
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
      googleCallbackCapture.run({ active: true, subject: "subject-a", email: "alpha@example.test" }, () =>
        db
          .prepare(
            `INSERT INTO account (id, providerId, accountId, userId)
        VALUES ('wrong-link', 'google', 'subject-b', 'principal-a')`,
          )
          .run(),
      ),
    ).toThrow(/google_email_proof_required/);
  } finally {
    db.close();
  }
});

it.each([false, true])("clears callback facts after handler completion or failure (%s)", async (fail) => {
  const db = proofDatabase();
  try {
    let captured: ReturnType<typeof googleCallbackCapture.getStore>;
    const handler = createAuthRequestHandler({
      rawHandler: async () => {
        captureGoogleEmailProof(db, { sub: "subject-a", email: "alpha@example.test", email_verified: true });
        captured = googleCallbackCapture.getStore();
        if (fail) throw new Error("callback failed");
        return new Response(null, { status: 302, headers: { location: "http://localhost/" } });
      },
      providerIdFromExternalContext: () => "google",
      callbackErrorUrl: () => new URL("http://localhost/error"),
      browserAuthErrorUrl: new URL("http://localhost/error"),
      commitResetSessions: () => {},
      reconcileFederatedLinks: () => {},
      microsoftProof: null,
    });
    const request = new Request("http://localhost/api/auth/callback/google");
    if (fail) await expect(handler(request)).rejects.toThrow("callback failed");
    else expect((await handler(request)).status).toBe(302);
    expect(captured?.active).toBe(false);
    expect(captured?.email).toBeNull();
    expect(captured?.subject).toBeNull();
  } finally {
    db.close();
  }
});
