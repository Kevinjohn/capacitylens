import type { SocialProviders } from "better-auth/social-providers";
import type { AuthConfigError } from "../auth";
import { persistLinkedExternalAvatar } from "./externalAvatar";
import type { Db } from "../db";
import type { MicrosoftProof } from "./microsoftProof";
import { MicrosoftProofError } from "./microsoftProofPrimitives";

type Env = Record<string, string | undefined>;
type AuthConfigErrorConstructor = typeof AuthConfigError;

const MICROSOFT_CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

function matchesMicrosoftAudience(audience: unknown, clientId: string): boolean {
  return audience === clientId || (Array.isArray(audience) && audience.length === 1 && audience[0] === clientId);
}

function hasLiveMicrosoftExpiry(expiresAt: unknown): boolean {
  return typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > Math.floor(Date.now() / 1000);
}

export function resolveMicrosoftTenantId(value: string | undefined, ErrorType: AuthConfigErrorConstructor): string {
  const tenant = value?.trim().toLowerCase();
  if (
    !tenant ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(tenant) ||
    tenant === MICROSOFT_CONSUMER_TENANT_ID
  ) {
    throw new ErrorType("SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID must be a specific work or school tenant GUID.");
  }
  return tenant;
}

export function readVerifiedMicrosoftProfile(
  value: unknown,
  tenant: string,
  clientId: string,
): {
  subject: string;
  picture: unknown;
} {
  if (typeof value !== "object" || value === null) throw new MicrosoftProofError("MICROSOFT_IDENTITY_INVALID", 403);
  const profile = value as Record<string, unknown>;
  const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
  const validTokenBoundary =
    profile.iss === issuer && matchesMicrosoftAudience(profile.aud, clientId) && profile.tid === tenant;
  const validExpiry = hasLiveMicrosoftExpiry(profile.exp);
  const validIdentity = typeof profile.oid === "string" && profile.oid.trim() !== "";
  if (!validTokenBoundary || !validExpiry || !validIdentity) {
    throw new MicrosoftProofError("MICROSOFT_IDENTITY_INVALID", 403);
  }
  return { subject: profile.oid as string, picture: profile.picture };
}

function configuredMicrosoftProvider({
  pair,
  tenantId,
  db,
  proof,
}: {
  pair: [string, string];
  tenantId: string;
  db: Db;
  proof: MicrosoftProof | null;
}): NonNullable<SocialProviders["microsoft"]> {
  return {
    clientId: pair[0],
    clientSecret: pair[1],
    mapProfileToUser: async (profile) => {
      const { subject, picture } = readVerifiedMicrosoftProfile(profile, tenantId, pair[0]);
      if (proof) {
        const proven = await proof.onProfile(profile, subject);
        return {
          ...persistLinkedExternalAvatar({ db, providerId: "microsoft", subject, value: picture }),
          ...proven,
        };
      }
      const existing = db
        .prepare(
          `SELECT user.email
           FROM account AS linked
           JOIN user ON user.id = linked.userId
           JOIN capacitylens_federated_link_observations AS proof
             ON proof.accountRowId = linked.id
            AND proof.principalId = linked.userId
            AND proof.providerId = linked.providerId
            AND proof.subject = linked.accountId
          WHERE linked.providerId = 'microsoft' AND linked.accountId = ?
          LIMIT 1`,
        )
        .get(subject) as { email: string } | undefined;
      if (!existing) return { emailVerified: false };
      return {
        ...persistLinkedExternalAvatar({ db, providerId: "microsoft", subject, value: picture }),
        email: existing.email,
        emailVerified: true,
      };
    },
    tenantId,
  };
}

function parseCredentialPair(input: {
  environment: Env;
  idKey: string;
  secretKey: string;
  label: string;
  ErrorType: AuthConfigErrorConstructor;
}): [string, string] | null {
  const { environment, idKey, secretKey, label, ErrorType } = input;
  const id = environment[idKey];
  const secret = environment[secretKey];
  if (!id && !secret) return null;
  if (!id || !secret) throw new ErrorType(`${idKey} and ${secretKey} must both be set to enable ${label}.`);
  return [id, secret];
}

/** Assemble configured native social providers with safe avatar claim projection. */
export function parseSocialProvidersFromEnvironment({
  environment,
  ErrorType,
  db,
  microsoftProof = null,
}: {
  environment: Env;
  ErrorType: AuthConfigErrorConstructor;
  db: Db;
  microsoftProof?: MicrosoftProof | null;
}): SocialProviders {
  const providers: SocialProviders = {};
  const pair = (idKey: string, secretKey: string, label: string) =>
    parseCredentialPair({ environment, idKey, secretKey, label, ErrorType });
  const google = pair("SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID", "SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET", "Google sign-in");
  if (google)
    providers.google = {
      clientId: google[0],
      clientSecret: google[1],
      mapProfileToUser: (profile) =>
        persistLinkedExternalAvatar({ db, providerId: "google", subject: profile.sub, value: profile.picture }),
    };
  const microsoft = pair(
    "SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID",
    "SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET",
    "Microsoft sign-in",
  );
  if (microsoft) {
    const tenantId = resolveMicrosoftTenantId(environment.SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID, ErrorType);
    providers.microsoft = configuredMicrosoftProvider({ pair: microsoft, tenantId, db, proof: microsoftProof });
  }
  const github = pair("SMALLSASS_ACCOUNT_GITHUB_CLIENT_ID", "SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET", "GitHub sign-in");
  if (github)
    providers.github = {
      clientId: github[0],
      clientSecret: github[1],
      mapProfileToUser: (profile) =>
        persistLinkedExternalAvatar({
          db,
          providerId: "github",
          subject: String(profile.id),
          value: profile.avatar_url,
        }),
    };
  return providers;
}
