import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import type { Db } from "../db";
import { tx } from "../txn";
import { googleCallbackCapture } from "./captureContexts";

function verifiedProfile(profile: { sub?: unknown; email?: unknown; email_verified?: unknown }) {
  const capture = googleCallbackCapture.getStore();
  const email = typeof profile.email === "string" ? normalizeAccountEmail(profile.email) : "";
  if (
    !capture?.active ||
    profile.email_verified !== true ||
    typeof profile.sub !== "string" ||
    !profile.sub.trim() ||
    !isAccountEmail(email)
  ) {
    throw new Error("Verified Google profile required for email proof.");
  }
  if (
    (capture.subject !== null && capture.subject !== profile.sub) ||
    (capture.email !== null && capture.email !== email)
  ) {
    throw new Error("Conflicting Google callback profile facts.");
  }
  capture.subject = profile.sub;
  capture.email = email;
  return { subject: profile.sub, email };
}

function assertOwnerCanKeepAccess(db: Db, principalId: string, email: string): void {
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

/** Called by the verified provider mapper; existing bindings are resolved by provider subject. */
export function captureGoogleEmailProof(
  db: Db,
  profile: {
    sub?: unknown;
    email?: unknown;
    email_verified?: unknown;
  },
): void {
  const { subject, email } = verifiedProfile(profile);
  const existing = db
    .prepare(
      `SELECT linked.userId, principal.email FROM account AS linked
    JOIN user AS principal ON principal.id = linked.userId
    WHERE linked.providerId = 'google' AND linked.accountId = ? LIMIT 1`,
    )
    .get(subject) as { userId: string; email: string } | undefined;
  if (!existing) return; // The account INSERT trigger records proof with the resolved principal.
  // A returning provider subject remains the same identity when its display email changes.
  // Only the current local address can gain mailbox proof; never replace it from a claim.
  if (normalizeAccountEmail(existing.email) !== email) return;
  tx(db, () => {
    assertOwnerCanKeepAccess(db, existing.userId, email);
    db.prepare(
      `INSERT INTO identity_email_proofs (principalId, email, source, provenAt)
      VALUES (?, ?, 'google', ?) ON CONFLICT(principalId) DO UPDATE SET
      email = excluded.email, source = excluded.source, provenAt = excluded.provenAt`,
    ).run(existing.userId, email, new Date().toISOString());
  });
}

/** The scalar reads request-local facts; account/proof writes and Owner guard share SQLite's transaction. */
export function ensureGoogleEmailProofGate(db: Db): void {
  db.function("capacitylens_google_proven_email", (subject) => {
    const capture = googleCallbackCapture.getStore();
    return capture?.active && capture.subject === subject ? capture.email : null;
  });
  db.exec(`CREATE TRIGGER IF NOT EXISTS capacitylens_google_email_proof_before
    BEFORE INSERT ON account WHEN NEW.providerId = 'google' BEGIN
      SELECT CASE WHEN capacitylens_google_proven_email(NEW.accountId) IS NULL
        OR capacitylens_google_proven_email(NEW.accountId) <> (SELECT lower(trim(email)) FROM user WHERE id = NEW.userId)
        THEN RAISE(ABORT, 'google_email_proof_required') END;
      SELECT CASE WHEN EXISTS (SELECT 1 FROM account_members AS member
        JOIN account_access_restrictions AS restriction ON restriction.accountId = member.accountId
        WHERE member.userId = NEW.userId AND member.role = 'owner' AND member.status = 'active'
          AND (restriction.principalId = NEW.userId
            OR restriction.verifiedEmail = capacitylens_google_proven_email(NEW.accountId)))
        THEN RAISE(ABORT, 'google_email_proof_owner_conflict') END;
    END;
    CREATE TRIGGER IF NOT EXISTS capacitylens_google_email_proof_after
    AFTER INSERT ON account WHEN NEW.providerId = 'google' BEGIN
      INSERT INTO identity_email_proofs (principalId, email, source, provenAt)
      VALUES (NEW.userId, capacitylens_google_proven_email(NEW.accountId), 'google', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(principalId) DO UPDATE SET email = excluded.email,
        source = excluded.source, provenAt = excluded.provenAt;
    END;`);
}
