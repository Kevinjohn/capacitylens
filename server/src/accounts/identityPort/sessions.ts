import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { ApplicationSession, OperationReceipt, SessionSummary } from "@capacitylens/shared/account/types";
import { SESSION_ABSOLUTE_TTL_SECONDS, SESSION_FRESH_AGE_SECONDS, SESSION_INACTIVITY_TTL_SECONDS } from "../../auth";
import { tx } from "../../txn";
import { createOperationReceipt } from "../accountFlowRuntime";
import { buildApplicationSessionHandle } from "../buildApplicationSessionHandle";
import { getSessionAuthentication, removeSessionAssurance, type RecordedSessionAuthentication } from "../state";
import type { IdentityPortContext } from "./contracts";
import type { SsoCutoverIdentityPort } from "./contracts";
import {
  buildIsoInstant,
  parseProviderInstant,
  buildStableFallbackSessionId,
  parseTimestampMilliseconds,
} from "./instants";
import { createInvalidProviderSessionError, createProviderFailure } from "./vendorErrors";

type SessionsContext = Pick<IdentityPortContext, "input" | "accountTableExists" | "revokePrincipalSessionsInTx">;
type SessionsPort = Pick<
  SsoCutoverIdentityPort,
  "verifyApplicationSession" | "signOut" | "listSessions" | "revokeOwnSession" | "revokePrincipalSessions"
>;
type ResolvedProviderSession = NonNullable<Awaited<ReturnType<SessionsContext["input"]["auth"]["api"]["getSession"]>>>;

type ProviderSessionRow = {
  id: string;
  token: string;
  createdAt: string | number;
  updatedAt: string | number;
  expiresAt: string | number | null;
};

export function createSessions(context: SessionsContext): SessionsPort {
  return {
    verifyApplicationSession: (request) => verifyApplicationSession(context, request),
    signOut: (request) => signOut(context, request),
    listSessions: (request) => listSessions(context, request),
    revokeOwnSession: (request) => revokeOwnSession(context, request),
    revokePrincipalSessions: (request) => revokePrincipalSessions(context, request),
  };
}

async function verifyApplicationSession(
  context: SessionsContext,
  { headers }: Parameters<SessionsPort["verifyApplicationSession"]>[0],
): Promise<ApplicationSession | null> {
  const { auth } = context.input;
  try {
    const resolved = await auth.api.getSession({ headers });
    if (!resolved) return null;
    return buildVerifiedApplicationSession(context, resolved);
  } catch (error) {
    if (error instanceof AccountContractError) throw error;
    throw createProviderFailure("Session verification is temporarily unavailable.", error);
  }
}

function buildVerifiedApplicationSession(
  context: SessionsContext,
  resolved: ResolvedProviderSession,
): ApplicationSession {
  const { applicationId, authMode, db } = context.input;
  const { createdAt, expiresAt } = resolveSessionInstants(resolved);
  const authentication = getSessionAuthentication(db, resolved.session?.id ?? "");
  assertTrustworthyLegacySession(context, resolved.user.id, authentication);
  const federatedIdentity = resolveFederatedIdentity(context, resolved.user.id, authentication);
  if (authMode === "sso" && !federatedIdentity) {
    throw createInvalidProviderSessionError(
      "The SSO-only profile received a session without federated assurance metadata.",
    );
  }
  const base = {
    id: resolved.session?.id ?? buildStableFallbackSessionId(applicationId, resolved.user.id, createdAt),
    principal: {
      id: resolved.user.id,
      displayName: resolved.user.name,
      email: resolved.user.email,
      emailVerified: resolved.user.emailVerified,
      image: resolved.user.image,
      linkedSubject: federatedIdentity?.linkedSubject ?? null,
    },
    createdAt,
    expiresAt,
    freshUntil: new Date(Date.parse(createdAt) + SESSION_FRESH_AGE_SECONDS * 1000).toISOString(),
  };
  if (federatedIdentity) return { ...base, assurance: "federated", providerId: federatedIdentity.providerId };
  let assurance: "password" | "mfa" = "password";
  if (authentication?.assurance === "mfa") assurance = "mfa";
  return { ...base, assurance, providerId: null };
}

function resolveSessionInstants(resolved: ResolvedProviderSession): { createdAt: string; expiresAt: string } {
  // A nonstandard adapter may omit the timestamp. Preserve authentication for ordinary reads,
  // but make the session provably stale so privileged freshness gates fail closed.
  const createdAt = parseProviderInstant(
    resolved.session?.createdAt ?? resolved.user.sessionCreatedAt ?? "1970-01-01T00:00:00.000Z",
    "createdAt",
  );
  const expiresAt = resolved.session?.expiresAt
    ? parseProviderInstant(resolved.session.expiresAt, "expiresAt")
    : new Date(Date.parse(createdAt) + SESSION_ABSOLUTE_TTL_SECONDS * 1000).toISOString();
  return { createdAt, expiresAt };
}

function assertTrustworthyLegacySession(
  { accountTableExists, input: { db } }: SessionsContext,
  principalId: string,
  authentication: RecordedSessionAuthentication | null,
): void {
  if (authentication) return;
  const providerRows = accountTableExists(db)
    ? (db.prepare(`SELECT providerId FROM account WHERE userId = ?`).all(principalId) as Array<{
        providerId: string;
      }>)
    : [];
  // Sessions created before the assurance migration may continue only when the principal is
  // unambiguously credential-only. An external or mixed principal without per-session
  // provenance must sign in again; treating it as password-authenticated would erase the
  // issuer/subject binding and could weaken an MFA or SSO policy.
  if (providerRows.length === 0 || providerRows.some((row) => row.providerId !== "credential")) {
    throw createInvalidProviderSessionError("The session has no trustworthy authentication-method provenance.");
  }
}

function resolveFederatedIdentity(
  { accountTableExists, input: { auth, db } }: SessionsContext,
  principalId: string,
  authentication: RecordedSessionAuthentication | null,
): { providerId: string; linkedSubject: NonNullable<ApplicationSession["principal"]["linkedSubject"]> } | null {
  if (authentication?.assurance !== "federated") return null;
  const providerId = authentication.providerId;
  if (!providerId || !accountTableExists(db)) throw missingFederatedBinding();
  const linkedRows = db
    .prepare(
      `
        SELECT providerId, accountId
          FROM account
         WHERE userId = ? AND providerId = ?
         ORDER BY providerId, accountId
         LIMIT 2
      `,
    )
    .all(principalId, providerId) as Array<{ providerId: string; accountId: string }>;
  if (linkedRows.length > 1) {
    throw createInvalidProviderSessionError(
      "The federated session maps to more than one immutable local issuer/subject binding.",
    );
  }
  const linked = linkedRows[0];
  const issuer = linked ? auth.federatedIssuers.get(linked.providerId) : undefined;
  if (!linked || !issuer) throw missingFederatedBinding();
  return { providerId, linkedSubject: { issuer, subject: linked.accountId } };
}

function missingFederatedBinding(): AccountContractError {
  return createInvalidProviderSessionError(
    "The federated session has no active immutable local issuer/subject binding.",
  );
}

async function signOut(
  { input }: SessionsContext,
  { headers }: Parameters<SessionsPort["signOut"]>[0],
): ReturnType<SessionsPort["signOut"]> {
  const { auth } = input;
  try {
    const configuredBaseUrl = typeof auth.options.baseURL === "string" ? auth.options.baseURL : "http://localhost";
    const response = await auth.handler(
      new Request(new URL("/api/auth/sign-out", input.publicBaseUrl ?? configuredBaseUrl), {
        method: "POST",
        headers,
      }),
    );
    if (!response.ok) throw new Error(`Identity provider returned HTTP ${response.status}.`);
    // Better Auth's session-delete database hook removes the assurance row in the same delete
    // path. Do not pre-resolve the session here: the sign-out endpoint already resolves it and a
    // second lookup would double the authenticated request's database work.
    return { setCookies: response.headers.getSetCookie() };
  } catch (error) {
    throw createProviderFailure("Sign-out is temporarily unavailable.", error);
  }
}

async function listSessions(
  { input }: SessionsContext,
  { actor }: Parameters<SessionsPort["listSessions"]>[0],
): Promise<readonly SessionSummary[]> {
  const { applicationId, db } = input;
  try {
    const rows = db
      .prepare(
        `
        SELECT id, token, createdAt, updatedAt, expiresAt
          FROM session
         WHERE userId = ?
         ORDER BY createdAt DESC
      `,
      )
      .all(actor.principalId) as ProviderSessionRow[];
    const now = Date.now();
    const active: SessionSummary[] = [];
    const expiredHandles: string[] = [];
    tx(db, () => {
      for (const row of rows) {
        const handle = buildApplicationSessionHandle(applicationId, row.token);
        if (isStaleSession(row, now)) {
          input.masqueradeSessions?.prepare([handle], "session_expired");
          db.prepare(`DELETE FROM session WHERE id = ? AND userId = ?`).run(row.id, actor.principalId);
          removeSessionAssurance(db, handle);
          expiredHandles.push(handle);
          continue;
        }
        active.push({
          id: handle,
          createdAt: buildIsoInstant(row.createdAt),
          expiresAt: row.expiresAt === null ? null : buildIsoInstant(row.expiresAt),
          current: handle === actor.sessionId,
        });
      }
    });
    input.masqueradeSessions?.commit(expiredHandles);
    return active;
  } catch (error) {
    throw createProviderFailure("Session listing is temporarily unavailable.", error);
  }
}

function isStaleSession(row: ProviderSessionRow, now: number): boolean {
  const createdAt = parseTimestampMilliseconds(row.createdAt);
  const updatedAt = parseTimestampMilliseconds(row.updatedAt);
  const providerExpiry = row.expiresAt === null ? null : parseTimestampMilliseconds(row.expiresAt);
  return (
    createdAt === null ||
    updatedAt === null ||
    (row.expiresAt !== null && providerExpiry === null) ||
    now >= createdAt + SESSION_ABSOLUTE_TTL_SECONDS * 1000 ||
    now >= updatedAt + SESSION_INACTIVITY_TTL_SECONDS * 1000 ||
    (providerExpiry !== null && now >= providerExpiry)
  );
}

async function revokeOwnSession(
  { input }: SessionsContext,
  { actor, sessionId, command }: Parameters<SessionsPort["revokeOwnSession"]>[0],
): Promise<OperationReceipt> {
  const { applicationId, db } = input;
  try {
    const rows = db.prepare(`SELECT id, token FROM session WHERE userId = ?`).all(actor.principalId) as Array<{
      id: string;
      token: string;
    }>;
    const row = rows.find((candidate) => buildApplicationSessionHandle(applicationId, candidate.token) === sessionId);
    if (row) {
      const handle = buildApplicationSessionHandle(applicationId, row.token);
      tx(db, () => {
        input.masqueradeSessions?.prepare([handle], "session_revoked");
        db.prepare(`DELETE FROM session WHERE id = ? AND userId = ?`).run(row.id, actor.principalId);
        removeSessionAssurance(db, sessionId);
      });
      input.masqueradeSessions?.commit([handle]);
    }
    return createOperationReceipt({ commandId: command.commandId, changed: row !== undefined });
  } catch (error) {
    throw createProviderFailure("Session revocation is temporarily unavailable.", error);
  }
}

async function revokePrincipalSessions(
  { input, revokePrincipalSessionsInTx }: SessionsContext,
  { targetPrincipalId, command }: Parameters<SessionsPort["revokePrincipalSessions"]>[0],
): Promise<OperationReceipt> {
  const { applicationId, db } = input;
  try {
    const masqueradeHandles = tx(
      db,
      () =>
        revokePrincipalSessionsInTx({
          db,
          applicationId,
          principalId: targetPrincipalId,
          lifecycle: input.masqueradeSessions,
        }),
      "immediate",
    );
    input.masqueradeSessions?.commit(masqueradeHandles);
    return createOperationReceipt({ commandId: command.commandId });
  } catch (error) {
    throw createProviderFailure("Session revocation is temporarily unavailable.", error);
  }
}
