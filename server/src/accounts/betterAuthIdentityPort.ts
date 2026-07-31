import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { IdentityPort } from "@capacitylens/shared/account/ports";
import type {
  ApplicationSession,
  OperationReceipt,
  PrincipalSummary,
  ProvisionalPrincipal,
  SessionSummary,
} from "@capacitylens/shared/account/types";
import { validateCredentialInput } from "@capacitylens/shared/account/validation";
import {
  RESET_LINK_TTL_SECONDS,
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_FRESH_AGE_SECONDS,
  SESSION_INACTIVITY_TTL_SECONDS,
  mintPasswordResetToken,
  revokeResetTokensForUser,
  type Auth,
  type AuthMode,
} from "../auth";
import type { Db } from "../db";
import { tx } from "../txn";
import {
  erasePrincipalCommandHistoryInTx,
  getSessionAuthentication,
  providerIdForIssuer,
  removePrincipalSessionAssurance,
  removeSecurityRevision,
  removeSessionAssurance,
} from "./state";
import { applicationSessionHandle } from "./sessionHandle";

export interface LocalIdentityPort extends IdentityPort {
  /** Embedded shared-SQLite capability: commit the credential identity and its coordinator-owned
   * principal correlation as one transaction. The callback must perform synchronous writes only. */
  createCorrelatedProvisionalCredentialPrincipal(
    input: Parameters<IdentityPort["createProvisionalCredentialPrincipal"]>[0] & {
      correlatePrincipalInTransaction(principalId: string): void;
    },
  ): Promise<ProvisionalPrincipal>;
  /** Embedded-only capability used while the coordinator already owns the SQLite transaction. */
  deprovisionLocalPrincipalInTx(principalId: string, exceptCommandId?: string): void;
  /** Embedded bulk capability for workspace erasure. Verification state is classified once for
   * the whole principal set while the coordinator owns the SQLite transaction. */
  deprovisionLocalPrincipalsInTx(principalIds: readonly string[], exceptCommandId?: string): void;
}

function providerFailure(message: string, cause: unknown): AccountContractError {
  return new AccountContractError(
    {
      code: "DEPENDENCY_UNAVAILABLE",
      message,
      retryable: true,
    },
    { cause },
  );
}

function invalidProviderSession(message: string): AccountContractError {
  return new AccountContractError({
    code: "DEPENDENCY_INVALID_RESPONSE",
    message,
    retryable: false,
  });
}

function providerErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const body = (error as { body?: unknown }).body;
  if (!body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function isDuplicateCredentialEmailError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const sqlite = error as { errcode?: unknown; message?: unknown };
  // node:sqlite exposes SQLite's extended SQLITE_CONSTRAINT_UNIQUE code (2067). The credential
  // writer's pinned schema has one user-table uniqueness conflict that means this caller fault:
  // the email column. Other constraints and provider lifecycle messages remain dependency errors.
  return sqlite.errcode === 2067 && sqlite.message === "UNIQUE constraint failed: user.email";
}

function stableFallbackSessionId(applicationId: string, principalId: string, createdAt: string): string {
  return createHash("sha256")
    .update(`${applicationId}-session-id\0`)
    .update(principalId)
    .update("\0")
    .update(createdAt)
    .digest("base64url");
}

function iso(value: string | number): string {
  return new Date(timestampMs(value)).toISOString();
}

function timestampMs(value: string | number): number {
  const numeric = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof numeric === "number" && numeric < 10_000_000_000 ? numeric * 1000 : new Date(numeric).getTime();
}

function providerInstant(value: string | number, field: "createdAt" | "expiresAt"): string {
  const milliseconds = timestampMs(value);
  if (!Number.isFinite(milliseconds)) {
    throw invalidProviderSession(`The provider session has an invalid ${field} timestamp.`);
  }
  return new Date(milliseconds).toISOString();
}

function receipt(commandId: string, changed?: boolean): OperationReceipt {
  return { commandId, completedAt: new Date().toISOString(), ...(changed === undefined ? {} : { changed }) };
}

function tableExists(db: Db, table: string): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !== undefined;
}

const MALFORMED_STRUCTURED_VERIFICATION = "Identity erasure cannot classify malformed structured verification state.";

class MalformedVerificationStateError extends Error {
  override name = "MalformedVerificationStateError";
}

function invalidVerificationState(commandId: string, cause: MalformedVerificationStateError): AccountContractError {
  return new AccountContractError(
    {
      code: "DEPENDENCY_INVALID_RESPONSE",
      message: MALFORMED_STRUCTURED_VERIFICATION,
      retryable: false,
      commandId,
    },
    { cause },
  );
}

/**
 * Return the principal linked by Better Auth's JSON OAuth state. Opaque scalar ceremonies (reset
 * tokens and similar values) are intentionally unrelated unless they exactly equal the principal.
 * An object-shaped value is different: if it cannot be decoded, erasure cannot prove that it is
 * unrelated, so throw and let the caller's transaction roll back instead of reporting completion.
 */
function accountLinkUserId(value: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    if (value.trimStart().startsWith("{")) {
      throw new MalformedVerificationStateError(MALFORMED_STRUCTURED_VERIFICATION, { cause });
    }
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  if (!Object.hasOwn(parsed, "link")) return null;
  const link = (parsed as { link: unknown }).link;
  if (typeof link !== "object" || link === null || Array.isArray(link)) {
    throw new MalformedVerificationStateError(MALFORMED_STRUCTURED_VERIFICATION);
  }
  const userId = (link as { userId?: unknown }).userId;
  if (typeof userId === "string" && userId.length > 0) return userId;
  if (typeof userId === "number" && Number.isFinite(userId)) return String(userId);
  throw new MalformedVerificationStateError(MALFORMED_STRUCTURED_VERIFICATION);
}

/** Delete only these installation-local Better Auth identities inside the caller's transaction. */
function eraseLocalPrincipalsInTx(db: Db, principalIds: readonly string[]): void {
  const principals = new Set(principalIds);
  if (principals.size === 0 || !tableExists(db, "user")) return;

  if (tableExists(db, "verification")) {
    // Scalar reset/email ceremonies can be removed entirely inside SQLite. Structured account-link
    // state still needs the fail-closed decoder below, but only values containing an object opener
    // can possibly carry that JSON shape; do not copy every opaque ceremony into JavaScript.
    const rows = db.prepare(`SELECT id, value FROM verification WHERE instr(value, '{') > 0`).all() as Array<{
      id: string;
      value: string;
    }>;
    const verificationIds: string[] = [];
    for (const row of rows) {
      if (principals.has(row.value)) {
        verificationIds.push(row.id);
        continue;
      }
      const linkedPrincipalId = accountLinkUserId(row.value);
      if (linkedPrincipalId !== null && principals.has(linkedPrincipalId)) {
        verificationIds.push(row.id);
      }
    }
    // JSON1 is already a schema prerequisite (command resultJson uses json_valid). Passing each set
    // as one JSON parameter avoids both a variable-count SQL string and one table scan per principal.
    db.prepare(`DELETE FROM verification WHERE value IN (SELECT value FROM json_each(?))`).run(
      JSON.stringify([...principals]),
    );
    if (verificationIds.length > 0) {
      db.prepare(`DELETE FROM verification WHERE id IN (SELECT value FROM json_each(?))`).run(
        JSON.stringify(verificationIds),
      );
    }
  }

  const removeSession = tableExists(db, "session") ? db.prepare(`DELETE FROM session WHERE userId = ?`) : null;
  const removeAccount = tableExists(db, "account") ? db.prepare(`DELETE FROM account WHERE userId = ?`) : null;
  const removeTwoFactor = tableExists(db, "twoFactor") ? db.prepare(`DELETE FROM twoFactor WHERE userId = ?`) : null;
  const removeUser = db.prepare(`DELETE FROM user WHERE id = ?`);
  for (const principalId of principals) {
    removePrincipalSessionAssurance(db, principalId);
    removeSession?.run(principalId);
    removeAccount?.run(principalId);
    removeTwoFactor?.run(principalId);
    removeUser.run(principalId);
    removeSecurityRevision(db, principalId);
  }
}

/** Better Auth and SQLite mechanics narrowed behind the provider-neutral IdentityPort. */
export function betterAuthIdentityPort(input: {
  applicationId: string;
  auth: Auth;
  authMode: Exclude<AuthMode, "off">;
  db: Db;
  publicBaseUrl?: string;
}): LocalIdentityPort {
  const { applicationId, auth, authMode, db } = input;
  const compensationKey = randomBytes(32);

  const makeCompensationHandle = (principalId: string, commandId: string): string =>
    createHash("sha256")
      .update(compensationKey)
      .update("\0")
      .update(principalId)
      .update("\0")
      .update(commandId)
      .digest("base64url");

  const assertCompensationHandle = (provisional: ProvisionalPrincipal, commandId: string): void => {
    const expected = Buffer.from(makeCompensationHandle(provisional.principalId, commandId));
    const actual = Buffer.from(provisional.compensationHandle);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new AccountContractError({
        code: "FORBIDDEN",
        message: "The provisional-principal compensation handle is invalid.",
        retryable: false,
        commandId,
      });
    }
  };

  const createCredentialPrincipal = async (
    input: Parameters<IdentityPort["createProvisionalCredentialPrincipal"]>[0],
    correlateInTransaction?: (principalId: string) => void,
  ): Promise<ProvisionalPrincipal> => {
    const { email, displayName, password, emailVerified, command } = input;
    if (authMode !== "password") {
      throw new AccountContractError({
        code: "UNSUPPORTED_CAPABILITY",
        message: "Credential identities are disabled for this installation.",
        retryable: false,
        commandId: command.commandId,
      });
    }
    const validation = validateCredentialInput({ email, displayName, password });
    if (validation) {
      throw new AccountContractError({
        code: "VALIDATION_FAILED",
        message:
          validation === "password-length"
            ? "The password does not meet the configured length policy."
            : validation === "email"
              ? "The email address is not normalized or valid."
              : "The display name is not valid.",
        retryable: false,
        commandId: command.commandId,
      });
    }
    try {
      const created = await auth.createCredentialUser(
        email,
        displayName,
        password,
        emailVerified,
        correlateInTransaction,
      );
      return {
        principalId: created.id,
        compensationHandle: makeCompensationHandle(created.id, command.commandId),
      };
    } catch (error) {
      if (["PASSWORD_COMPROMISED", "PASSWORD_CONTEXT_REJECTED"].includes(providerErrorCode(error) ?? "")) {
        throw new AccountContractError(
          {
            code: "VALIDATION_FAILED",
            message:
              error instanceof Error && error.message
                ? error.message
                : "The password does not meet the configured security policy.",
            retryable: false,
            commandId: command.commandId,
          },
          { cause: error },
        );
      }
      if (isDuplicateCredentialEmailError(error)) {
        throw new AccountContractError(
          {
            code: "IDENTITY_ALREADY_EXISTS",
            message: "A sign-in identity already exists for that email address.",
            retryable: false,
            commandId: command.commandId,
          },
          { cause: error },
        );
      }
      throw providerFailure("Identity creation is temporarily unavailable.", error);
    }
  };

  return {
    deprovisionLocalPrincipalInTx(principalId, exceptCommandId): void {
      erasePrincipalCommandHistoryInTx(db, principalId, exceptCommandId);
      eraseLocalPrincipalsInTx(db, [principalId]);
    },
    deprovisionLocalPrincipalsInTx(principalIds, exceptCommandId): void {
      for (const principalId of new Set(principalIds)) {
        erasePrincipalCommandHistoryInTx(db, principalId, exceptCommandId);
      }
      eraseLocalPrincipalsInTx(db, principalIds);
    },
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
          const providerRows = tableExists(db, "account")
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
          authentication?.assurance === "federated" && authentication.providerId && tableExists(db, "account")
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
        return {
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
          assurance,
        };
      } catch (error) {
        if (error instanceof AccountContractError) throw error;
        throw providerFailure("Session verification is temporarily unavailable.", error);
      }
    },

    async getPrincipalSummaries({ principalIds }): Promise<readonly PrincipalSummary[]> {
      if (principalIds.length === 0) return [];
      try {
        const unique = [...new Set(principalIds)];
        const summaries: PrincipalSummary[] = [];
        for (let offset = 0; offset < unique.length; offset += 500) {
          const chunk = unique.slice(offset, offset + 500);
          const placeholders = chunk.map(() => "?").join(", ");
          summaries.push(
            ...db
              .prepare(`SELECT id, name, email FROM user WHERE id IN (${placeholders})`)
              .all(...chunk)
              .map((row) => {
                const value = row as { id: string; name: string | null; email: string | null };
                return { id: value.id, displayName: value.name, email: value.email };
              }),
          );
        }
        return summaries;
      } catch (error) {
        throw providerFailure("Identity summaries are temporarily unavailable.", error);
      }
    },

    async findPrincipalByFederatedSubject({ subject }): Promise<PrincipalSummary | null> {
      try {
        // The identity key is the provider/issuer plus upstream subject pair. Email is deliberately
        // absent from this lookup and can never correlate two product identities.
        const providerId = providerIdForIssuer(db, applicationId, subject.issuer);
        if (!providerId) return null;
        const rows = db
          .prepare(
            `
          SELECT u.id, u.name, u.email
            FROM account AS a
            JOIN user AS u ON u.id = a.userId
           WHERE a.providerId = ? AND a.accountId = ?
           LIMIT 2
        `,
          )
          .all(providerId, subject.subject) as Array<{
          id: string;
          name: string | null;
          email: string | null;
        }>;
        if (rows.length > 1) {
          throw invalidProviderSession("The federated subject maps to more than one local principal.");
        }
        const row = rows[0];
        return row ? { id: row.id, displayName: row.name, email: row.email } : null;
      } catch (error) {
        if (error instanceof AccountContractError) throw error;
        throw providerFailure("Federated identity lookup is temporarily unavailable.", error);
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
              db.prepare(`DELETE FROM session WHERE id = ? AND userId = ?`).run(row.id, actor.principalId);
              removeSessionAssurance(db, handle);
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
          tx(db, () => {
            db.prepare(`DELETE FROM session WHERE id = ? AND userId = ?`).run(row.id, actor.principalId);
            removeSessionAssurance(db, sessionId);
          });
        }
        return receipt(command.commandId, row !== undefined);
      } catch (error) {
        throw providerFailure("Session revocation is temporarily unavailable.", error);
      }
    },

    async createProvisionalCredentialPrincipal(input): Promise<ProvisionalPrincipal> {
      return createCredentialPrincipal(input);
    },

    async createCorrelatedProvisionalCredentialPrincipal({
      correlatePrincipalInTransaction,
      ...input
    }): Promise<ProvisionalPrincipal> {
      return createCredentialPrincipal(input, correlatePrincipalInTransaction);
    },

    async compensateProvisionalPrincipal({ provisional, command }): Promise<void> {
      assertCompensationHandle(provisional, command.commandId);
      try {
        tx(db, () => {
          erasePrincipalCommandHistoryInTx(db, provisional.principalId, command.commandId);
          eraseLocalPrincipalsInTx(db, [provisional.principalId]);
        });
      } catch (error) {
        if (error instanceof MalformedVerificationStateError) {
          throw invalidVerificationState(command.commandId, error);
        }
        throw providerFailure("Provisional identity compensation failed.", error);
      }
    },

    async deprovisionLocalPrincipal({ principalId, command }): Promise<OperationReceipt> {
      try {
        // This deletes only the installation-local user and local provider-link rows. It never calls
        // an upstream IdP deletion or management API.
        tx(db, () => {
          erasePrincipalCommandHistoryInTx(db, principalId, command.commandId);
          eraseLocalPrincipalsInTx(db, [principalId]);
        });
        return receipt(command.commandId);
      } catch (error) {
        if (error instanceof MalformedVerificationStateError) {
          throw invalidVerificationState(command.commandId, error);
        }
        throw providerFailure("Local identity deprovisioning failed.", error);
      }
    },

    async issuePasswordReset({ targetPrincipalId, command }) {
      if (authMode !== "password") {
        throw new AccountContractError({
          code: "UNSUPPORTED_CAPABILITY",
          message: "Password reset is unavailable for an SSO-only installation.",
          retryable: false,
          commandId: command.commandId,
        });
      }
      try {
        const row = db.prepare(`SELECT email FROM user WHERE id = ?`).get(targetPrincipalId) as
          { email: string } | undefined;
        if (!row?.email) {
          throw new AccountContractError({
            code: "NOT_FOUND",
            message: "No local sign-in identity exists for this member.",
            retryable: false,
            commandId: command.commandId,
          });
        }
        const token = await mintPasswordResetToken(auth, row.email);
        if (!token) {
          throw new AccountContractError({
            code: "NOT_FOUND",
            message: "No local sign-in identity exists for this member.",
            retryable: false,
            commandId: command.commandId,
          });
        }
        return {
          ceremonyId: createHash("sha256")
            .update(`${applicationId}-reset-ceremony\0`)
            .update(token)
            .digest("base64url"),
          token,
          expiresAt: new Date(Date.now() + RESET_LINK_TTL_SECONDS * 1000).toISOString(),
        };
      } catch (error) {
        if (error instanceof AccountContractError) throw error;
        throw providerFailure("Password-reset issuance is temporarily unavailable.", error);
      }
    },

    async revokePasswordResetCeremony({ targetPrincipalId }): Promise<void> {
      try {
        // Better Auth hashes ceremony identifiers at rest, so targeted deletion is unavailable.
        // Conservatively revoking every outstanding ceremony for this principal is fail-closed.
        revokeResetTokensForUser(db, targetPrincipalId);
      } catch (error) {
        throw providerFailure("Password-reset ceremony revocation failed.", error);
      }
    },

    async revokePrincipalSessions({ targetPrincipalId, command }): Promise<OperationReceipt> {
      try {
        const sessions = db.prepare(`SELECT token FROM session WHERE userId = ?`).all(targetPrincipalId) as Array<{
          token: string;
        }>;
        await auth.revokeUserSessions(targetPrincipalId);
        for (const session of sessions) {
          removeSessionAssurance(db, applicationSessionHandle(applicationId, session.token));
        }
        return receipt(command.commandId);
      } catch (error) {
        throw providerFailure("Session revocation is temporarily unavailable.", error);
      }
    },
  };
}
