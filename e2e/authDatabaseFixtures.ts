import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

/**
 * Seed only disposable auth-e2e role/access fixtures. Real invitation tests use the addressed invite path.
 * The principal must already exist in the disposable auth database.
 * @throws When the principal is absent or database writes fail.
 */
export function seedFixtureMember(accountId: string, email: string, role: "admin" | "editor" | "viewer"): void {
  const path = fileURLToPath(new URL("../server/.auth-e2e.db", import.meta.url));
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const principal = db.prepare("SELECT id FROM user WHERE lower(email) = ?").get(email.toLowerCase()) as
      { id: string } | undefined;
    if (!principal) throw new Error(`Missing E2E fixture identity for ${email}`);
    db.prepare(
      `INSERT INTO account_members (accountId, userId, role, status, createdAt)
       VALUES (?, ?, ?, 'active', ?)`,
    ).run(accountId, principal.id, role, new Date().toISOString());
  } finally {
    db.close();
  }
}

/** Seed a pre-existing trusted address only in the disposable auth-e2e database. This prepares
 * the policy-joining prerequisite; the browser test still performs real sign-in and membership
 * admission. It does not test provider or mailbox proof issuance. */
export function seedFixtureEmailProof(email: string): void {
  const path = fileURLToPath(new URL("../server/.auth-e2e.db", import.meta.url));
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const principal = db.prepare("SELECT id FROM user WHERE lower(email) = ?").get(email.toLowerCase()) as
      { id: string } | undefined;
    if (!principal) throw new Error(`Missing E2E fixture identity for ${email}`);
    db.prepare(
      "INSERT INTO identity_email_proofs (principalId, email, source, provenAt) VALUES (?, ?, 'google', ?)",
    ).run(principal.id, email.toLowerCase(), new Date().toISOString());
  } finally {
    db.close();
  }
}

/** Mark only the legacy auth-vendor flag in the disposable E2E database. A joining test uses this
 * to prove that the flag alone is not the durable address evidence required for policy admission. */
export function seedFixtureLegacyEmailFlag(email: string): void {
  const path = fileURLToPath(new URL("../server/.auth-e2e.db", import.meta.url));
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const updated = db.prepare("UPDATE user SET emailVerified = 1 WHERE lower(email) = ?").run(email.toLowerCase());
    if (updated.changes !== 1) throw new Error(`Missing E2E fixture identity for ${email}`);
  } finally {
    db.close();
  }
}
