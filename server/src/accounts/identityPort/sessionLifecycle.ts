import type { OperationReceipt, SessionSummary } from "@capacitylens/shared/account/types";
import { SESSION_ABSOLUTE_TTL_SECONDS, SESSION_INACTIVITY_TTL_SECONDS } from "../../auth";
import { tx } from "../../txn";
import { createOperationReceipt } from "../accountFlowRuntime";
import { buildApplicationSessionHandle } from "../buildApplicationSessionHandle";
import { removeSessionAssurance } from "../state";
import type { IdentityPortContext } from "./contracts";
import type { SsoCutoverIdentityPort } from "./contracts";
import { buildIsoInstant, parseTimestampMilliseconds } from "./instants";
import { createProviderFailure } from "./vendorErrors";

type SessionLifecycleContext = {
  input: Pick<IdentityPortContext["input"], "applicationId" | "auth" | "db" | "publicBaseUrl" | "masqueradeSessions">;
  revokePrincipalSessionsInTx: IdentityPortContext["revokePrincipalSessionsInTx"];
};
type SessionLifecyclePort = Pick<
  SsoCutoverIdentityPort,
  "signOut" | "listSessions" | "revokeOwnSession" | "revokePrincipalSessions"
>;

type ProviderSessionRow = {
  id: string;
  token: string;
  createdAt: string | number;
  updatedAt: string | number;
  expiresAt: string | number | null;
};

/** Creates session lifecycle operations for the configured database and cleanup hooks. */
export function createSessionLifecycle(context: SessionLifecycleContext): SessionLifecyclePort {
  return {
    signOut: (request) => signOut(context, request),
    listSessions: (request) => listSessions(context, request),
    revokeOwnSession: (request) => revokeOwnSession(context, request),
    revokePrincipalSessions: (request) => revokePrincipalSessions(context, request),
  };
}

async function signOut(
  { input }: SessionLifecycleContext,
  { headers }: Parameters<SessionLifecyclePort["signOut"]>[0],
): ReturnType<SessionLifecyclePort["signOut"]> {
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
    return {
      setCookies: [
        ...response.headers.getSetCookie(),
        ...(auth.microsoftProof ? [auth.microsoftProof.cancel(headers)] : []),
      ],
    };
  } catch (error) {
    // Surface identity-store failures as dependency errors while preserving their cause for diagnostics.
    throw createProviderFailure("Sign-out is temporarily unavailable.", error);
  }
}

async function listSessions(
  { input }: SessionLifecycleContext,
  { actor }: Parameters<SessionLifecyclePort["listSessions"]>[0],
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
    // Surface identity-store failures as dependency errors while preserving their cause for diagnostics.
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
  { input }: SessionLifecycleContext,
  { actor, sessionId, command }: Parameters<SessionLifecyclePort["revokeOwnSession"]>[0],
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
    // Surface identity-store failures as dependency errors while preserving their cause for diagnostics.
    throw createProviderFailure("Session revocation is temporarily unavailable.", error);
  }
}

async function revokePrincipalSessions(
  { input, revokePrincipalSessionsInTx }: SessionLifecycleContext,
  { targetPrincipalId, command }: Parameters<SessionLifecyclePort["revokePrincipalSessions"]>[0],
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
    // Surface identity-store failures as dependency errors while preserving their cause for diagnostics.
    throw createProviderFailure("Session revocation is temporarily unavailable.", error);
  }
}
