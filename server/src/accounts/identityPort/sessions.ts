import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { ApplicationSession, OperationReceipt, SessionSummary } from "@capacitylens/shared/account/types";
import { SESSION_ABSOLUTE_TTL_SECONDS, SESSION_FRESH_AGE_SECONDS, SESSION_INACTIVITY_TTL_SECONDS } from "../../auth";
import { tx } from "../../txn";
import { receipt } from "../accountFlowRuntime";
import { applicationSessionHandle } from "../sessionHandle";
import { getSessionAuthentication, removeSessionAssurance } from "../state";
import type { IdentityPortContext } from "./contracts";
import type { SsoCutoverIdentityPort } from "./contracts";
import { iso, providerInstant, stableFallbackSessionId, timestampMs } from "./instants";
import { invalidProviderSession, providerFailure } from "./vendorErrors";

export function createSessions(
  context: Pick<IdentityPortContext, "input" | "accountTableExists" | "revokePrincipalSessionsInTx">,
): Pick<
  SsoCutoverIdentityPort,
  "verifyApplicationSession" | "signOut" | "listSessions" | "revokeOwnSession" | "revokePrincipalSessions"
> {
  const { input, accountTableExists, revokePrincipalSessionsInTx } = context;
  const { applicationId, auth, authMode, db } = input;

  return {
    async verifyApplicationSession({ headers }): Promise<ApplicationSession | null> {
      try {
        const resolved = await auth.api.getSession({ headers });
        if (!resolved) return null;
        // A nonstandard adapter may omit the timestamp. Preserve authentication for ordinary reads,
        // but make the session provably stale so privileged freshness gates fail closed.
        const createdAt = providerInstant(
          resolved.session?.createdAt ?? resolved.user.sessionCreatedAt ?? "1970-01-01T00:00:00.000Z",
          "createdAt",
        );
        const expiresAt = resolved.session?.expiresAt
          ? providerInstant(resolved.session.expiresAt, "expiresAt")
          : new Date(Date.parse(createdAt) + SESSION_ABSOLUTE_TTL_SECONDS * 1000).toISOString();
        const authentication = getSessionAuthentication(db, resolved.session?.id ?? "");
        if (!authentication) {
          const providerRows = accountTableExists(db)
            ? (db.prepare(`SELECT providerId FROM account WHERE userId = ?`).all(resolved.user.id) as Array<{
                providerId: string;
              }>)
            : [];
          // Sessions created before the assurance migration may continue only when the principal is
          // unambiguously credential-only. An external or mixed principal without per-session
          // provenance must sign in again; treating it as password-authenticated would erase the
          // issuer/subject binding and could weaken an MFA or SSO policy.
          if (providerRows.length === 0 || providerRows.some((row) => row.providerId !== "credential")) {
            throw invalidProviderSession("The session has no trustworthy authentication-method provenance.");
          }
        }
        const linkedRows =
          authentication?.assurance === "federated" && authentication.providerId && accountTableExists(db)
            ? (db
                .prepare(
                  `
              SELECT providerId, accountId
                FROM account
               WHERE userId = ? AND providerId = ?
               ORDER BY providerId, accountId
               LIMIT 2
            `,
                )
                .all(resolved.user.id, authentication.providerId) as Array<{ providerId: string; accountId: string }>)
            : [];
        if (linkedRows.length > 1) {
          throw invalidProviderSession(
            "The federated session maps to more than one immutable local issuer/subject binding.",
          );
        }
        const linked = linkedRows[0];
        const linkedIssuer = linked ? auth.federatedIssuers.get(linked.providerId) : undefined;
        if (authentication?.assurance === "federated" && (!linked || !linkedIssuer)) {
          throw invalidProviderSession("The federated session has no active immutable local issuer/subject binding.");
        }
        if (authMode === "sso" && authentication?.assurance !== "federated") {
          throw invalidProviderSession("The SSO-only profile received a session without federated assurance metadata.");
        }
        const assurance =
          authentication?.assurance === "federated" && linked
            ? "federated"
            : authentication?.assurance === "mfa"
              ? "mfa"
              : "password";
        const base = {
          id: resolved.session?.id ?? stableFallbackSessionId(applicationId, resolved.user.id, createdAt),
          principal: {
            id: resolved.user.id,
            displayName: resolved.user.name,
            email: resolved.user.email,
            emailVerified: resolved.user.emailVerified,
            image: resolved.user.image,
            linkedSubject: linked
              ? {
                  issuer: linkedIssuer!,
                  subject: linked.accountId,
                }
              : null,
          },
          createdAt,
          expiresAt,
          freshUntil: new Date(Date.parse(createdAt) + SESSION_FRESH_AGE_SECONDS * 1000).toISOString(),
        };
        return assurance === "federated"
          ? { ...base, assurance, providerId: authentication!.providerId! }
          : { ...base, assurance, providerId: null };
      } catch (error) {
        if (error instanceof AccountContractError) throw error;
        throw providerFailure("Session verification is temporarily unavailable.", error);
      }
    },
    async signOut({ headers }) {
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
        const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
        return {
          setCookies: getSetCookie
            ? getSetCookie.call(response.headers)
            : response.headers.get("set-cookie")
              ? [response.headers.get("set-cookie")!]
              : [],
        };
      } catch (error) {
        throw providerFailure("Sign-out is temporarily unavailable.", error);
      }
    },
    async listSessions({ actor }): Promise<readonly SessionSummary[]> {
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
          .all(actor.principalId) as Array<{
          id: string;
          token: string;
          createdAt: string | number;
          updatedAt: string | number;
          expiresAt: string | number | null;
        }>;
        const now = Date.now();
        const active: SessionSummary[] = [];
        const expiredHandles: string[] = [];
        tx(db, () => {
          for (const row of rows) {
            const createdAt = timestampMs(row.createdAt);
            const updatedAt = timestampMs(row.updatedAt);
            const providerExpiry = row.expiresAt === null ? null : timestampMs(row.expiresAt);
            const stale =
              !Number.isFinite(createdAt) ||
              !Number.isFinite(updatedAt) ||
              (providerExpiry !== null && !Number.isFinite(providerExpiry)) ||
              now >= createdAt + SESSION_ABSOLUTE_TTL_SECONDS * 1000 ||
              now >= updatedAt + SESSION_INACTIVITY_TTL_SECONDS * 1000 ||
              (providerExpiry !== null && now >= providerExpiry);
            const handle = applicationSessionHandle(applicationId, row.token);
            if (stale) {
              input.masqueradeSessions?.prepare([handle], "session_expired");
              db.prepare(`DELETE FROM session WHERE id = ? AND userId = ?`).run(row.id, actor.principalId);
              removeSessionAssurance(db, handle);
              expiredHandles.push(handle);
              continue;
            }
            active.push({
              id: handle,
              createdAt: iso(row.createdAt),
              expiresAt: row.expiresAt === null ? null : iso(row.expiresAt),
              current: handle === actor.sessionId,
            });
          }
        });
        input.masqueradeSessions?.commit(expiredHandles);
        return active;
      } catch (error) {
        throw providerFailure("Session listing is temporarily unavailable.", error);
      }
    },
    async revokeOwnSession({ actor, sessionId, command }): Promise<OperationReceipt> {
      try {
        const rows = db.prepare(`SELECT id, token FROM session WHERE userId = ?`).all(actor.principalId) as Array<{
          id: string;
          token: string;
        }>;
        const row = rows.find((candidate) => applicationSessionHandle(applicationId, candidate.token) === sessionId);
        if (row) {
          const handle = applicationSessionHandle(applicationId, row.token);
          tx(db, () => {
            input.masqueradeSessions?.prepare([handle], "session_revoked");
            db.prepare(`DELETE FROM session WHERE id = ? AND userId = ?`).run(row.id, actor.principalId);
            removeSessionAssurance(db, sessionId);
          });
          input.masqueradeSessions?.commit([handle]);
        }
        return receipt(command.commandId, row !== undefined);
      } catch (error) {
        throw providerFailure("Session revocation is temporarily unavailable.", error);
      }
    },
    async revokePrincipalSessions({ targetPrincipalId, command }): Promise<OperationReceipt> {
      try {
        const masqueradeHandles = tx(
          db,
          () => revokePrincipalSessionsInTx(db, applicationId, targetPrincipalId, input.masqueradeSessions),
          "immediate",
        );
        input.masqueradeSessions?.commit(masqueradeHandles);
        return receipt(command.commandId);
      } catch (error) {
        throw providerFailure("Session revocation is temporarily unavailable.", error);
      }
    },
  };
}
