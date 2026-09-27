import type { Db } from "../db";
import { AccountContractError, assertRetryAfterSeconds } from "@capacitylens/shared/account/errors";

export type JoinIntentState = "started" | "mail-sent" | "approved" | "completed" | "cancelled";
export interface JoinIntent {
  id: string;
  nonceHash: string;
  browserHash: string;
  purpose: "policy" | "invitation";
  accountId: string;
  invitationId: string | null;
  email: string;
  principalId: string | null;
  providerId: string;
  state: JoinIntentState;
  tokenHash: string | null;
  deliveryGeneration: number;
  expiresAt: number;
  sentCount: number;
  lastSentAt: number | null;
  sourceIpHash: string;
  providerStateHash: string | null;
  createdAt: number;
  updatedAt: number;
}

const RATE_WINDOW_MS = 60 * 60_000;
const MIN_SEND_SPACING_MS = 60_000;

function limited(): never {
  throw new AccountContractError({
    code: "RATE_LIMITED",
    message: "Too many verification messages. Try again later.",
    retryable: true,
    retryAfterSeconds: assertRetryAfterSeconds(60),
  });
}

export function readJoinIntent(db: Db, nonceHash: string): JoinIntent | null {
  return (
    (db.prepare("SELECT * FROM company_join_intents WHERE nonceHash = ?").get(nonceHash) as JoinIntent | undefined) ??
    null
  );
}

export function pruneJoinIntents(db: Db, now: number): void {
  db.prepare("DELETE FROM company_join_intents WHERE COALESCE(lastSentAt, createdAt) < ?").run(now - RATE_WINDOW_MS);
}

/** Aggregate limits survive intent replacement and mail failures. Caller owns a write transaction. */
function assertSendQuota(db: Db, intent: JoinIntent, now: number): void {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(sentCount), 0) AS count, MAX(lastSentAt) AS latest
      FROM company_join_intents WHERE lastSentAt > ? AND
      (email = ? OR browserHash = ? OR sourceIpHash = ?)`,
    )
    .get(now - RATE_WINDOW_MS, intent.email, intent.browserHash, intent.sourceIpHash) as {
    count: number;
    latest: number | null;
  };
  if (row.count >= 5 || (row.latest !== null && row.latest > now - MIN_SEND_SPACING_MS)) limited();
  const global = db
    .prepare("SELECT COALESCE(SUM(sentCount), 0) AS count FROM company_join_intents WHERE lastSentAt > ?")
    .get(now - RATE_WINDOW_MS) as { count: number };
  if (global.count >= 300) limited();
}

export function insertJoinIntent(db: Db, intent: JoinIntent): void {
  db.prepare(
    `INSERT INTO company_join_intents
    (id, nonceHash, browserHash, purpose, accountId, invitationId, email, principalId, providerId,
     state, tokenHash, deliveryGeneration, expiresAt, sentCount, lastSentAt, sourceIpHash,
     providerStateHash, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    intent.id,
    intent.nonceHash,
    intent.browserHash,
    intent.purpose,
    intent.accountId,
    intent.invitationId,
    intent.email,
    intent.principalId,
    intent.providerId,
    intent.state,
    intent.tokenHash,
    intent.deliveryGeneration,
    intent.expiresAt,
    intent.sentCount,
    intent.lastSentAt,
    intent.sourceIpHash,
    intent.providerStateHash,
    intent.createdAt,
    intent.updatedAt,
  );
}

/** Reserve a unique mail generation before SMTP; delayed failure can clear only this generation. */
export function reserveJoinDelivery(input: { db: Db; intent: JoinIntent; tokenHash: string; now: number }): number {
  const { db, intent, tokenHash, now } = input;
  if (intent.expiresAt <= now || (intent.state !== "started" && intent.state !== "mail-sent")) {
    throw new AccountContractError({
      code: "INVITATION_EXPIRED",
      message: "Restart company joining.",
      retryable: false,
    });
  }
  assertSendQuota(db, intent, now);
  const generation = intent.deliveryGeneration + 1;
  const changed = db
    .prepare(
      `UPDATE company_join_intents SET state = 'mail-sent', tokenHash = ?,
    deliveryGeneration = ?, sentCount = sentCount + 1, lastSentAt = ?, updatedAt = ?
    WHERE id = ? AND deliveryGeneration = ? AND state IN ('started', 'mail-sent') AND expiresAt > ?`,
    )
    .run(tokenHash, generation, now, now, intent.id, intent.deliveryGeneration, now);
  if (changed.changes !== 1) throw new Error("Company joining delivery changed concurrently.");
  return generation;
}

export function clearFailedJoinDelivery(input: { db: Db; id: string; generation: number; tokenHash: string }): void {
  const { db, id, generation, tokenHash } = input;
  db.prepare(
    `UPDATE company_join_intents SET state = 'started', tokenHash = NULL
    WHERE id = ? AND deliveryGeneration = ? AND tokenHash = ? AND state = 'mail-sent'`,
  ).run(id, generation, tokenHash);
}

export function approveJoinToken(input: {
  db: Db;
  nonceHash: string;
  tokenHash: string;
  now: number;
}): JoinIntent | null {
  const { db, nonceHash, tokenHash, now } = input;
  const row = readJoinIntent(db, nonceHash);
  if (!row || row.state !== "mail-sent" || row.tokenHash !== tokenHash || row.expiresAt <= now) return null;
  const changed = db
    .prepare(
      `UPDATE company_join_intents SET state = 'approved', tokenHash = NULL, updatedAt = ?
    WHERE id = ? AND state = 'mail-sent' AND tokenHash = ? AND expiresAt > ?`,
    )
    .run(now, row.id, tokenHash, now);
  return changed.changes === 1 ? { ...row, state: "approved", tokenHash: null, updatedAt: now } : null;
}

export function completeJoinIntent(input: { db: Db; intent: JoinIntent; principalId: string; now: number }): void {
  const { db, intent, principalId, now } = input;
  const changed = db
    .prepare(
      `UPDATE company_join_intents SET state = 'completed', principalId = ?, updatedAt = ?
    WHERE id = ? AND state = 'approved' AND expiresAt > ?
      AND (principalId IS NULL OR principalId = ?)`,
    )
    .run(principalId, now, intent.id, now, principalId);
  if (changed.changes !== 1) throw new Error("Company joining intent changed before admission.");
}

export function cancelJoinIntent(db: Db, nonceHash: string, now: number): void {
  db.prepare(
    `UPDATE company_join_intents SET state = 'cancelled', tokenHash = NULL, updatedAt = ?
    WHERE nonceHash = ? AND state IN ('started', 'mail-sent', 'approved')`,
  ).run(now, nonceHash);
}

export function removeJoinIntentsForAccount(db: Db, accountId: string): void {
  db.prepare("DELETE FROM company_join_intents WHERE accountId = ?").run(accountId);
}
