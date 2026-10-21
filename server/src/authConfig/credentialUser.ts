import { randomBytes } from "node:crypto";
import { cleanText } from "@capacitylens/shared/lib/strings";
import type { Db } from "../db";
import { tx } from "../txn";
import type { CreateCredentialUserInput } from "./authTypes";

// Better Auth owns hashing; the shared handle lets credential creation include its command correlation atomically.
interface CredentialUserContext {
  password: { hash: (password: string) => Promise<string> };
}

interface CreateCredentialUserWithInput extends CreateCredentialUserInput {
  context: CredentialUserContext;
  db: Db;
}

/**
 * Hash outside the write transaction, then commit the Better Auth user, credential link and an
 * optional same-database correlation callback as one synchronous SQLite unit. Better Auth's
 * node:sqlite adapter ultimately writes these same pinned tables; using the shared handle here is
 * what lets invitation onboarding cross its provider/coordinator boundary without a crash gap.
 */
export async function createCredentialUserWith({
  context,
  db,
  email,
  name,
  password,
  emailVerified = false,
  correlateInTransaction,
}: CreateCredentialUserWithInput): Promise<{ id: string }> {
  const hash = await context.password.hash(password);
  const cleanedName = cleanText(name);
  return tx(
    db,
    () => {
      // Better Auth's default ids are opaque random strings. Keep the same 32-character base64url
      // shape while generating user and provider-link identities independently.
      const userId = randomBytes(24).toString("base64url");
      const accountId = randomBytes(24).toString("base64url");
      const now = Date.now();
      db.prepare(
        `
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      ).run(userId, cleanedName || "User", email.toLowerCase(), emailVerified ? 1 : 0, now, now);
      db.prepare(
        `
      INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES (?, ?, 'credential', ?, ?, ?, ?)
    `,
      ).run(accountId, userId, userId, hash, now, now);
      correlateInTransaction?.(userId);
      return { id: userId };
    },
    "immediate",
  );
}
