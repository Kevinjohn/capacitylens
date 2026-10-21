import { AccountContractError } from "@capacitylens/shared/account/errors";
import { allowsPasswordSignIn, allowsProviderSignIn } from "@capacitylens/shared/account/types";
import type { ApplicationSession } from "@capacitylens/shared/account/types";
import { SESSION_ABSOLUTE_TTL_SECONDS, SESSION_FRESH_AGE_SECONDS } from "../../auth";
import type { IdentityPortContext, SsoCutoverIdentityPort } from "./contracts";
import type { RecordedSessionAuthentication } from "../state";
import { getSessionAuthentication } from "../state";
import { buildStableFallbackSessionId, parseProviderInstant } from "./instants";
import { createInvalidProviderSessionError, createProviderFailure } from "./vendorErrors";
import { parseResourceAvatarUrl } from "@capacitylens/shared/domain/resourceAvatarUrl";

type SessionVerificationContext = {
  input: Pick<IdentityPortContext["input"], "applicationId" | "auth" | "authMode" | "db">;
  accountTableExists: IdentityPortContext["accountTableExists"];
};
type ResolvedProviderSession = NonNullable<
  Awaited<ReturnType<SessionVerificationContext["input"]["auth"]["api"]["getSession"]>>
>;

/** Verifies provider session provenance and maps it to the application session contract. */
export async function verifyApplicationSession(
  context: SessionVerificationContext,
  { headers }: Parameters<SsoCutoverIdentityPort["verifyApplicationSession"]>[0],
): Promise<ApplicationSession | null> {
  const { auth } = context.input;
  try {
    const resolved = await auth.api.getSession({ headers });
    if (!resolved) return null;
    return buildVerifiedApplicationSession(context, resolved);
  } catch (error) {
    // Preserve recognized account failures and surface unexpected identity-store failures as dependency errors with their cause.
    if (error instanceof AccountContractError) throw error;
    throw createProviderFailure("Session verification is temporarily unavailable.", error);
  }
}

function narrowProviderImage(value: unknown): string | null {
  return parseResourceAvatarUrl(value) ?? null;
}

function buildVerifiedApplicationSession(
  context: SessionVerificationContext,
  resolved: ResolvedProviderSession,
): ApplicationSession | null {
  const { applicationId, authMode, db } = context.input;
  const { createdAt, expiresAt } = resolveSessionInstants(resolved);
  const authentication = getSessionAuthentication(db, resolved.session?.id ?? "");
  assertTrustworthyLegacySession(context, resolved.user.id, authentication);
  if (!sessionMethodAllowed(authMode, authentication)) return null;
  const federatedIdentity = resolveFederatedIdentity(context, resolved.user.id, authentication);
  assertSsoFederatedIdentity(authMode, federatedIdentity);
  if (isDisallowedCompanyAuthentication(context, authentication)) return null;
  const base = {
    id: resolved.session?.id ?? buildStableFallbackSessionId(applicationId, resolved.user.id, createdAt),
    principal: {
      id: resolved.user.id,
      displayName: resolved.user.name,
      email: resolved.user.email,
      emailVerified: resolved.user.emailVerified,
      image: narrowProviderImage(resolved.user.image),
      linkedSubject: federatedIdentity?.linkedSubject ?? null,
    },
    createdAt,
    expiresAt,
    freshUntil: new Date(Date.parse(createdAt) + SESSION_FRESH_AGE_SECONDS * 1000).toISOString(),
  };
  if (federatedIdentity) return { ...base, assurance: "federated", providerId: federatedIdentity.providerId };
  return { ...base, assurance: "password", providerId: null };
}

function sessionMethodAllowed(
  mode: SessionVerificationContext["input"]["authMode"],
  authentication: RecordedSessionAuthentication | null,
): boolean {
  return authentication?.assurance === "federated" ? allowsProviderSignIn(mode) : allowsPasswordSignIn(mode);
}

function assertSsoFederatedIdentity(
  mode: SessionVerificationContext["input"]["authMode"],
  identity: ReturnType<typeof resolveFederatedIdentity>,
): void {
  if (mode === "sso-only" && !identity) {
    throw createInvalidProviderSessionError(
      "The SSO-only profile received a session without federated assurance metadata.",
    );
  }
}

function isDisallowedCompanyAuthentication(
  context: SessionVerificationContext,
  authentication: RecordedSessionAuthentication | null,
): boolean {
  return (
    context.input.authMode === "sso-only" &&
    authentication?.assurance === "federated" &&
    !context.input.auth.permittedCompanyProviderIds?.has(authentication.providerId ?? "")
  );
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
  { accountTableExists, input: { db } }: SessionVerificationContext,
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
  // issuer/subject binding and could weaken an SSO policy.
  if (providerRows.length === 0 || providerRows.some((row) => row.providerId !== "credential")) {
    throw createInvalidProviderSessionError("The session has no trustworthy authentication-method provenance.");
  }
}

function resolveFederatedIdentity(
  { accountTableExists, input: { auth, db } }: SessionVerificationContext,
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
