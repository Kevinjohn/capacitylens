import type { Db } from "../db";
import type { AuthConfigError, AuthProviderInfo } from "../auth";
import { parseSocialProvidersFromEnvironment, resolveMicrosoftTenantId } from "./socialProviders";
import type { AuthProviderBrand } from "./authTypes";
import type { MicrosoftProof } from "./microsoftProof";

type Env = Record<string, string | undefined>;
type AuthConfigErrorConstructor = typeof AuthConfigError;

export function companyProviderIds(providers: readonly AuthProviderInfo[]): ReadonlySet<string> {
  return new Set(providers.filter((provider) => !provider.experimental).map((provider) => provider.id));
}

function configuredProviderInfo(environment: Env): AuthProviderInfo[] {
  const providers: AuthProviderInfo[] = [];
  const add = (id: string, label: string, brand: AuthProviderBrand): void => {
    providers.push({ id, label, kind: "social", brand, experimental: id === "github" });
  };
  if (environment.SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID && environment.SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET) {
    add("google", "Google", "google");
  }
  if (environment.SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID && environment.SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET) {
    add("microsoft", "Microsoft", "microsoft");
  }
  if (environment.SMALLSASS_ACCOUNT_GITHUB_CLIENT_ID && environment.SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET) {
    add("github", "GitHub", "generic");
  }
  return providers;
}

export function buildProviders({
  env,
  trustedOrigins,
  db,
  AuthConfigError,
  microsoftProof,
}: {
  env: Env;
  trustedOrigins: string[] | undefined;
  AuthConfigError: AuthConfigErrorConstructor;
  db: Db;
  microsoftProof?: MicrosoftProof | null;
}) {
  const configuredSocialProviders = parseSocialProvidersFromEnvironment({
    environment: env,
    ErrorType: AuthConfigError,
    db,
    microsoftProof: microsoftProof ?? null,
  });
  const configuredFederatedIssuers = new Map<string, string>();
  if (configuredSocialProviders.google) configuredFederatedIssuers.set("google", "https://accounts.google.com");
  if (configuredSocialProviders.microsoft) {
    configuredFederatedIssuers.set(
      "microsoft",
      `urn:better-auth:microsoft:${resolveMicrosoftTenantId(env.SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID, AuthConfigError)}`,
    );
  }
  if (configuredSocialProviders.github) configuredFederatedIssuers.set("github", "urn:better-auth:github");
  return {
    configuredSocialProviders,
    configuredProviderInfo: configuredProviderInfo(env),
    configuredFederatedIssuers,
    trustedOrigins,
  };
}
