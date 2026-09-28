import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import type { Db } from "../db";
import { tx } from "../txn";
import { federatedCallbackCapture } from "./captureContexts";

type ProvenProvider = "google" | "github";
type ProviderFact = { providerId: ProvenProvider; subject: unknown; email: unknown; verified: boolean };

function hasVerifiedAddress(input: ProviderFact, email: string): input is ProviderFact & { subject: string } {
  return input.verified && typeof input.subject === "string" && Boolean(input.subject.trim()) && isAccountEmail(email);
}

function captureVerifiedFacts(input: ProviderFact): { subject: string; email: string } {
  const capture = federatedCallbackCapture.getStore();
  const email = typeof input.email === "string" ? normalizeAccountEmail(input.email) : "";
  if (!capture?.active || capture.providerId !== input.providerId || !hasVerifiedAddress(input, email)) {
    throw new Error("Verified provider profile required for email proof.");
  }
  if (
    (capture.subject !== null && capture.subject !== input.subject) ||
    (capture.email !== null && capture.email !== email)
  ) {
    throw new Error("Conflicting provider callback profile facts.");
  }
  capture.subject = input.subject;
  capture.email = email;
  return { subject: input.subject, email };
}

/** Refuse proof that would disable an active Owner through an address restriction. */
export function assertOwnerCanKeepAccess(db: Db, principalId: string, email: string): void {
  const owner = db
    .prepare(
      `SELECT 1 FROM account_members AS member
    JOIN account_access_restrictions AS restriction ON restriction.accountId = member.accountId
    WHERE member.userId = ? AND member.role = 'owner' AND member.status = 'active'
      AND (restriction.principalId = ? OR restriction.verifiedEmail = ?) LIMIT 1`,
    )
    .get(principalId, principalId, email);
  if (owner) throw new Error("Verified address conflicts with company Owner access.");
}

/** Store only the exact address verified by this provider in this callback. */
export function captureVerifiedFederatedEmailProof(db: Db, input: ProviderFact): void {
  const { subject, email } = captureVerifiedFacts(input);
  const existing = db
    .prepare(
      `SELECT linked.userId, principal.email FROM account AS linked
    JOIN user AS principal ON principal.id = linked.userId
    WHERE linked.providerId = ? AND linked.accountId = ? LIMIT 1`,
    )
    .get(input.providerId, subject) as { userId: string; email: string } | undefined;
  if (!existing) return; // The account INSERT trigger records proof with the resolved principal.
  // Stable provider subjects remain the same identity across profile email drift. Only the
  // current local address can gain proof; the callback never changes the principal's email.
  if (normalizeAccountEmail(existing.email) !== email) return;
  tx(db, () => {
    assertOwnerCanKeepAccess(db, existing.userId, email);
    db.prepare(
      `INSERT INTO identity_email_proofs (principalId, email, source, provenAt)
      VALUES (?, ?, ?, ?) ON CONFLICT(principalId) DO UPDATE SET
      email = excluded.email, source = excluded.source, provenAt = excluded.provenAt`,
    ).run(existing.userId, email, input.providerId, new Date().toISOString());
  });
}

export function captureGoogleEmailProof(
  db: Db,
  profile: { sub?: unknown; email?: unknown; email_verified?: unknown },
): void {
  captureVerifiedFederatedEmailProof(db, {
    providerId: "google",
    subject: profile.sub,
    email: profile.email,
    verified: profile.email_verified === true,
  });
}

/** SQLite observes only request-local, provider-and-subject-bound verified facts. */
export function ensureFederatedEmailProofGate(db: Db): void {
  db.function("capacitylens_federated_proven_email", (providerId, subject) => {
    const capture = federatedCallbackCapture.getStore();
    return capture?.active && capture.providerId === providerId && capture.subject === subject ? capture.email : null;
  });
  db.exec(`DROP TRIGGER IF EXISTS capacitylens_google_email_proof_before;
    DROP TRIGGER IF EXISTS capacitylens_google_email_proof_after;
    DROP TRIGGER IF EXISTS capacitylens_federated_email_proof_before;
    DROP TRIGGER IF EXISTS capacitylens_federated_email_proof_after;
    CREATE TRIGGER capacitylens_federated_email_proof_before
    BEFORE INSERT ON account WHEN NEW.providerId IN ('google', 'github') BEGIN
      SELECT CASE WHEN capacitylens_federated_proven_email(NEW.providerId, NEW.accountId) IS NULL
        OR capacitylens_federated_proven_email(NEW.providerId, NEW.accountId) <>
          (SELECT lower(trim(email)) FROM user WHERE id = NEW.userId)
        THEN RAISE(ABORT, 'federated_email_proof_required') END;
      SELECT CASE WHEN EXISTS (SELECT 1 FROM account_members AS member
        JOIN account_access_restrictions AS restriction ON restriction.accountId = member.accountId
        WHERE member.userId = NEW.userId AND member.role = 'owner' AND member.status = 'active'
          AND (restriction.principalId = NEW.userId
            OR restriction.verifiedEmail = capacitylens_federated_proven_email(NEW.providerId, NEW.accountId)))
        THEN RAISE(ABORT, 'federated_email_proof_owner_conflict') END;
    END;
    CREATE TRIGGER capacitylens_federated_email_proof_after
    AFTER INSERT ON account WHEN NEW.providerId IN ('google', 'github') BEGIN
      INSERT INTO identity_email_proofs (principalId, email, source, provenAt)
      VALUES (NEW.userId, capacitylens_federated_proven_email(NEW.providerId, NEW.accountId),
        NEW.providerId, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(principalId) DO UPDATE SET email = excluded.email,
        source = excluded.source, provenAt = excluded.provenAt;
    END;`);
}
