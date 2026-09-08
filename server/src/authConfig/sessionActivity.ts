import { cleanText } from "@capacitylens/shared/lib/strings";
import type { Db } from "../db";
import { tx } from "../txn";
import type { RawSessionUser, SessionUser } from "./authTypes";
import { SESSION_INACTIVITY_TTL_SECONDS, SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS } from "./authConstants";

/** Parse stored activity as epoch milliseconds or ISO text; malformed values have no timestamp. */
function parseSessionTimestamp(value: string | number | null | undefined): number | null {
  let milliseconds: number | null = null;
  if (typeof value === "number") milliseconds = value;
  if (typeof value === "string") milliseconds = Date.parse(value);
  return milliseconds !== null && Number.isFinite(milliseconds) ? milliseconds : null;
}

type SessionActivityResult = { kind: "deleted" } | { kind: "active"; currentMs: number };
type SessionActivityLifecycle = {
  prepare(sessionToken: string, reason: "session_expired"): readonly string[];
  commit(sessionHandles: readonly string[]): void;
};
type SessionActivitySession = { session: { token: string; updatedAt: Date | string } };
type StoredSessionActivity = { updatedAt: string | number | null };

/**
 * Apply the app's idle timeout to a session Better Auth has already resolved.
 *
 * STORAGE REPRESENTATION IS NOT ASSUMED. Better Auth 1.6.x on node:sqlite stores
 * `session.updatedAt` as ISO-8601 *text*, not the integer epoch milliseconds an earlier
 * version of this function trusted a comment about. Comparing or writing numbers against a
 * text-valued column means SQL predicates silently never match (INTEGER always sorts before
 * TEXT), which turned both the expiry compare-and-set and the activity touch into no-ops on
 * production rows. So: read the raw stored value, parse whatever is there, compare-and-set
 * against the RAW value, and write back in the SAME representation that is stored. Direct
 * conditional SQL is required because the adapter exposes only unconditional async writes and
 * cannot provide compare-and-set; the CAS keeps deletes and touches monotonic even when
 * overlapping requests settle out of order. Fails closed (row deleted, `null` returned) on an
 * unparseable timestamp.
 */
type SessionActivityStatements = {
  read: ReturnType<Db["prepare"]>;
  destroy: ReturnType<Db["prepare"]>;
  casDelete: ReturnType<Db["prepare"]>;
  casTouch: ReturnType<Db["prepare"]>;
};
type SessionActivityContext = {
  db: Db;
  statements: SessionActivityStatements;
  lifecycle: SessionActivityLifecycle | undefined;
};

// This runs on every authenticated request (via enforceSessionActivity below) — cache the four
// prepared statements per Db handle instead of re-preparing them on each call. WeakMap keyed by
// the Db handle: an entry is collected with its handle, so tests that spin up many short-lived
// in-memory handles don't leak.
const sessionActivityStatementCache = new WeakMap<Db, SessionActivityStatements>();

function createSessionActivityStatements(db: Db): SessionActivityStatements {
  const cached = sessionActivityStatementCache.get(db);
  if (cached) return cached;
  const statements: SessionActivityStatements = {
    read: db.prepare(`SELECT updatedAt FROM session WHERE token = ?`),
    destroy: db.prepare(`DELETE FROM session WHERE token = ?`),
    casDelete: db.prepare(`DELETE FROM session WHERE token = ? AND updatedAt = ?`),
    casTouch: db.prepare(`UPDATE session SET updatedAt = ? WHERE token = ? AND updatedAt = ?`),
  };
  sessionActivityStatementCache.set(db, statements);
  return statements;
}

function readSessionActivity(statements: SessionActivityStatements, token: string): StoredSessionActivity | undefined {
  return statements.read.get(token) as StoredSessionActivity | undefined;
}

function destroySession(context: SessionActivityContext, token: string, lifecycle?: SessionActivityLifecycle): null {
  let sessionHandles: readonly string[] = [];
  tx(
    context.db,
    () => {
      if (lifecycle) sessionHandles = lifecycle.prepare(token, "session_expired");
      context.statements.destroy.run(token);
    },
    "immediate",
  );
  if (lifecycle) lifecycle.commit(sessionHandles);
  return null;
}

function adoptSessionActivity<Session extends SessionActivitySession>(session: Session, currentMs: number): Session {
  session.session.updatedAt = new Date(currentMs);
  return session;
}

function enforceExpiredSessionWithoutLifecycle<Session extends SessionActivitySession>(
  session: Session,
  context: SessionActivityContext,
  row: StoredSessionActivity,
): Session | null {
  const token = session.session.token;
  const removed = context.statements.casDelete.run(token, row.updatedAt);
  if (removed.changes >= 1) return null;

  // Lost a race to a concurrent touch between the read and the delete — re-read it.
  const current = readSessionActivity(context.statements, token);
  if (!current) return null;
  const currentMs = parseSessionTimestamp(current.updatedAt);
  if (currentMs === null) return destroySession(context, token);
  return adoptSessionActivity(session, currentMs);
}

function enforceExpiredSessionWithLifecycle<Session extends SessionActivitySession>(
  session: Session,
  context: SessionActivityContext,
  lifecycle: SessionActivityLifecycle,
): Session | null {
  const token = session.session.token;
  const lastActivity = new Date(session.session.updatedAt).getTime();
  let sessionHandles: readonly string[] = [];
  const result = tx(
    context.db,
    (): SessionActivityResult => {
      // Re-read after taking the writer reservation. Another process may have touched the row
      // between the optimistic read and this transaction.
      const current = readSessionActivity(context.statements, token);
      if (!current) return { kind: "deleted" };
      const currentMs = parseSessionTimestamp(current.updatedAt);
      if (currentMs !== null && currentMs !== lastActivity) return { kind: "active", currentMs };
      sessionHandles = lifecycle.prepare(token, "session_expired");
      context.statements.destroy.run(token);
      return { kind: "deleted" };
    },
    "immediate",
  );
  if (result.kind === "active") return adoptSessionActivity(session, result.currentMs);
  lifecycle.commit(sessionHandles);
  return null;
}

function enforceExpiredSession<Session extends SessionActivitySession>(
  session: Session,
  context: SessionActivityContext,
  lifecycle?: SessionActivityLifecycle,
): Session | null {
  const token = session.session.token;
  const lastActivity = new Date(session.session.updatedAt).getTime();
  if (!Number.isFinite(lastActivity)) return destroySession(context, token, lifecycle);

  const row = readSessionActivity(context.statements, token);
  if (!row) return null;
  const rowMs = parseSessionTimestamp(row.updatedAt);
  if (rowMs === null) return destroySession(context, token, lifecycle);
  if (rowMs !== lastActivity) return adoptSessionActivity(session, rowMs);
  if (!lifecycle) return enforceExpiredSessionWithoutLifecycle(session, context, row);
  return enforceExpiredSessionWithLifecycle(session, context, lifecycle);
}

function touchSessionActivity<Session extends SessionActivitySession>(
  session: Session,
  context: SessionActivityContext,
  now: number,
): Session | null {
  const token = session.session.token;
  const row = readSessionActivity(context.statements, token);
  if (!row) return null;
  const rowMs = parseSessionTimestamp(row.updatedAt);
  if (rowMs === null) return destroySession(context, token, context.lifecycle);
  if (rowMs >= now) return adoptSessionActivity(session, rowMs);

  const next: string | number = typeof row.updatedAt === "number" ? now : new Date(now).toISOString();
  const touched = context.statements.casTouch.run(next, token, row.updatedAt);
  if (touched.changes >= 1) return adoptSessionActivity(session, now);

  // A concurrent touch won the CAS; adopt whatever it wrote.
  const current = readSessionActivity(context.statements, token);
  if (!current) return null;
  const currentMs = parseSessionTimestamp(current.updatedAt);
  if (currentMs === null) return destroySession(context, token, context.lifecycle);
  return adoptSessionActivity(session, currentMs);
}

export async function enforceSessionActivity<Session extends SessionActivitySession>(
  session: Session,
  db: Db,
  lifecycle?: SessionActivityLifecycle,
): Promise<Session | null> {
  const context = { db, statements: createSessionActivityStatements(db), lifecycle };
  const lastActivity = new Date(session.session.updatedAt).getTime();
  const now = Date.now();
  const elapsed = now - lastActivity;
  const expired = !Number.isFinite(lastActivity) || elapsed < 0 || elapsed >= SESSION_INACTIVITY_TTL_SECONDS * 1000;
  if (expired) return enforceExpiredSession(session, context, lifecycle);
  if (elapsed >= SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS * 1000) return touchSessionActivity(session, context, now);
  return session;
}

/**
 * Narrow Better Auth's full user to the {@link SessionUser} the server uses, reading
 * `emailVerified` from the raw user and defaulting it to `false`.
 *
 * Better Auth sets `emailVerified` per provider during sign-in (Google/Microsoft OIDC derive
 * it from the `email_verified` claim; GitHub and email+password sign-up leave it `false` until
 * verified). We deliberately do NOT branch on a provider allow-list — we trust Better Auth's
 * per-provider value and use `?? false` as the safety net for any provider that omits it, so an
 * unverifiable provider can never present as verified.
 */
export function buildSessionUser(raw: RawSessionUser): SessionUser {
  const name = cleanText(typeof raw.name === "string" ? raw.name : "");
  return {
    id: raw.id,
    email: raw.email,
    emailVerified: raw.emailVerified ?? false,
    twoFactorEnabled: raw.twoFactorEnabled === true,
    name: name || "User",
    image: parseImageUrl(raw.image),
  };
}

/** `user.image` is only ever written by strictOidc's `optionalPictureUrl` (https-only, no embedded
 *  credentials, ≤2048 chars — see server/src/strictOidc.ts), so a stored value is already validated.
 *  This backstop re-asserts the https invariant at the narrowing boundary so a non-https value (a
 *  hand-edited row, a future writer) can never reach the client as an `<img src>`. */
function parseImageUrl(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("https://") ? value : null;
}

// session.create.after (in authFromEnv below) runs on every newly created session — cache the
// prepared MFA-enrolment lookup per Db handle instead of re-preparing it on each call. WeakMap
// keyed by the Db handle: an entry is collected with its handle, so tests that spin up many
// short-lived in-memory handles don't leak.
const twoFactorEnabledLookupCache = new WeakMap<Db, ReturnType<Db["prepare"]>>();

export function createTwoFactorEnabledLookupStatement(db: Db): ReturnType<Db["prepare"]> {
  const cached = twoFactorEnabledLookupCache.get(db);
  if (cached) return cached;
  const statement = db.prepare("SELECT twoFactorEnabled FROM user WHERE id = ?");
  twoFactorEnabledLookupCache.set(db, statement);
  return statement;
}
