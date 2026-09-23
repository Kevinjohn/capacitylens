import {
  ACCOUNT_PROFILE_CAPABILITIES,
  isAccountDeploymentProfile,
  type AccountDeploymentProfile,
} from "@capacitylens/shared/account/conformance";

export type { AccountDeploymentProfile } from "@capacitylens/shared/account/conformance";

export class AccountConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountConfigError";
  }
}

const RETIRED_ACCOUNT_NAMES = {
  CAPACITYLENS_AUTH: "SMALLSASS_ACCOUNT_MODE",
  BETTER_AUTH_SECRET: "SMALLSASS_ACCOUNT_SECRET",
  BETTER_AUTH_URL: "SMALLSASS_ACCOUNT_PUBLIC_URL",
  CAPACITYLENS_SETUP_TOKEN: "SMALLSASS_ACCOUNT_SETUP_TOKEN",
  CAPACITYLENS_ALLOW_OPEN_SIGNUP: "SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP",
  CAPACITYLENS_REQUIRE_MFA: "SMALLSASS_ACCOUNT_REQUIRE_MFA",
  CAPACITYLENS_PASSWORD_BREACH_CHECK: "SMALLSASS_ACCOUNT_PASSWORD_BREACH_CHECK",
  CAPACITYLENS_SSO_MFA_ENFORCED: "SMALLSASS_ACCOUNT_SSO_MFA_ENFORCED",
  CAPACITYLENS_SSO_CLIENT_ID: "SMALLSASS_ACCOUNT_OIDC_CLIENT_ID",
  CAPACITYLENS_SSO_CLIENT_SECRET: "SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET",
  CAPACITYLENS_SSO_DISCOVERY_URL: "SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL",
  CAPACITYLENS_SSO_ISSUER: "SMALLSASS_ACCOUNT_OIDC_ISSUER",
  CAPACITYLENS_SSO_AUTHORIZATION_URL: "SMALLSASS_ACCOUNT_OIDC_AUTHORIZATION_URL",
  CAPACITYLENS_SSO_TOKEN_URL: "SMALLSASS_ACCOUNT_OIDC_TOKEN_URL",
  CAPACITYLENS_SSO_SCOPES: "SMALLSASS_ACCOUNT_OIDC_SCOPES",
  CAPACITYLENS_SSO_PROVIDER_ID: "SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID",
  CAPACITYLENS_SSO_LABEL: "SMALLSASS_ACCOUNT_OIDC_LABEL",
  CAPACITYLENS_SSO_BRAND: "SMALLSASS_ACCOUNT_OIDC_BRAND",
  CAPACITYLENS_SSO_BOOTSTRAP_EMAILS: "SMALLSASS_ACCOUNT_OIDC_BOOTSTRAP_EMAILS",
  CAPACITYLENS_GOOGLE_CLIENT_ID: "SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID",
  CAPACITYLENS_GOOGLE_CLIENT_SECRET: "SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET",
  CAPACITYLENS_MICROSOFT_CLIENT_ID: "SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID",
  CAPACITYLENS_MICROSOFT_CLIENT_SECRET: "SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET",
  CAPACITYLENS_MICROSOFT_TENANT_ID: "SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID",
  CAPACITYLENS_GITHUB_CLIENT_ID: "SMALLSASS_ACCOUNT_GITHUB_CLIENT_ID",
  CAPACITYLENS_GITHUB_CLIENT_SECRET: "SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET",
} as const;

const CANONICAL_ACCOUNT_NAMES: string[] = [
  ...Object.values(RETIRED_ACCOUNT_NAMES),
  "SMALLSASS_ACCOUNT_PROVIDER_BOOTSTRAP_EMAILS",
  "SMALLSASS_ACCOUNT_MAIL_HOST",
  "SMALLSASS_ACCOUNT_MAIL_PORT",
  "SMALLSASS_ACCOUNT_MAIL_USER",
  "SMALLSASS_ACCOUNT_MAIL_PASSWORD",
  "SMALLSASS_ACCOUNT_MAIL_FROM",
];

const SECRET_KEYS = new Set<string>([
  "SMALLSASS_ACCOUNT_SECRET",
  "SMALLSASS_ACCOUNT_SETUP_TOKEN",
  "SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET",
  "SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET",
  "SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET",
  "SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET",
  "SMALLSASS_ACCOUNT_MAIL_PASSWORD",
]);

const resolvedAccountEnvironments = new WeakMap<object, AccountDeploymentProfile | null>();

function normalizeSetting(key: string, value: string): string {
  if (SECRET_KEYS.has(key)) return value;
  if (key === "SMALLSASS_ACCOUNT_MODE") return value.trim().toLowerCase();
  if (key === "SMALLSASS_ACCOUNT_OIDC_SCOPES") return value.trim().split(/\s+/).join(" ");
  return value.trim();
}

function parseConfiguredValue(key: string, value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (value.trim() === "") {
    if (key === "SMALLSASS_ACCOUNT_MODE") {
      throw new AccountConfigError(`${key} contains only whitespace; refusing to choose a security posture.`);
    }
    return undefined;
  }
  return value;
}

export interface ResolvedAccountEnvironment {
  env: Record<string, string | undefined>;
  profile: AccountDeploymentProfile | null;
}

type AccountEnvironment = Record<string, string | undefined>;

function assertNoRetiredAccountNames(source: AccountEnvironment): void {
  for (const [retired, canonical] of Object.entries(RETIRED_ACCOUNT_NAMES)) {
    // Compose still projects these variables as empty placeholders. Empty values carry no
    // configuration and are removed below; any value, including whitespace, is refused.
    if (source[retired] !== undefined && source[retired] !== "")
      throw new AccountConfigError(`${retired} was removed; use ${canonical}.`);
  }
}

function resolveCanonicalSettings(source: AccountEnvironment): AccountEnvironment {
  const environment = { ...source };
  for (const retired of Object.keys(RETIRED_ACCOUNT_NAMES)) {
    delete environment[retired];
  }
  for (const canonical of CANONICAL_ACCOUNT_NAMES) {
    const canonicalValue = parseConfiguredValue(canonical, source[canonical]);
    if (canonicalValue === undefined) {
      delete environment[canonical];
      continue;
    }
    environment[canonical] = normalizeSetting(canonical, canonicalValue);
  }
  return environment;
}

function readDeploymentProfile(source: AccountEnvironment): AccountDeploymentProfile | null {
  const rawProfile = source.SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE?.trim();
  const profile = rawProfile === undefined || rawProfile === "" ? null : rawProfile;
  if (profile !== null && !isAccountDeploymentProfile(profile)) {
    throw new AccountConfigError(
      "SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE must be self-hosted-password, self-hosted-mixed, self-hosted-sso-only, or hosted-oidc-only.",
    );
  }
  return profile;
}

const EXTERNAL_IDENTITY_KEYS = [
  "SMALLSASS_ACCOUNT_OIDC_CLIENT_ID",
  "SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET",
  "SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL",
  "SMALLSASS_ACCOUNT_OIDC_ISSUER",
  "SMALLSASS_ACCOUNT_OIDC_AUTHORIZATION_URL",
  "SMALLSASS_ACCOUNT_OIDC_TOKEN_URL",
  "SMALLSASS_ACCOUNT_OIDC_SCOPES",
  "SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID",
  "SMALLSASS_ACCOUNT_OIDC_LABEL",
  "SMALLSASS_ACCOUNT_OIDC_BRAND",
  "SMALLSASS_ACCOUNT_OIDC_BOOTSTRAP_EMAILS",
  "SMALLSASS_ACCOUNT_PROVIDER_BOOTSTRAP_EMAILS",
  "SMALLSASS_ACCOUNT_MAIL_HOST",
  "SMALLSASS_ACCOUNT_MAIL_PORT",
  "SMALLSASS_ACCOUNT_MAIL_USER",
  "SMALLSASS_ACCOUNT_MAIL_PASSWORD",
  "SMALLSASS_ACCOUNT_MAIL_FROM",
  "SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID",
  "SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET",
  "SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID",
  "SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET",
  "SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID",
  "SMALLSASS_ACCOUNT_GITHUB_CLIENT_ID",
  "SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET",
] as const;

const SOCIAL_PROVIDER_KEYS = [
  "SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID",
  "SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET",
  "SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID",
  "SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET",
  "SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID",
  "SMALLSASS_ACCOUNT_GITHUB_CLIENT_ID",
  "SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET",
] as const;

function hasConfiguredKey(environment: AccountEnvironment, keys: readonly string[]): boolean {
  return keys.some((key) => environment[key] !== undefined);
}

function assertStrictOidcMaterial(environment: AccountEnvironment, message: string): void {
  const requiredKeys = [
    "SMALLSASS_ACCOUNT_OIDC_CLIENT_ID",
    "SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET",
    "SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL",
    "SMALLSASS_ACCOUNT_OIDC_ISSUER",
  ];
  if (!requiredKeys.every((key) => environment[key])) throw new AccountConfigError(message);
}

function assertHostedPasswordConfigurationAbsent(environment: AccountEnvironment, source: AccountEnvironment): void {
  const passwordKeys = [
    "SMALLSASS_ACCOUNT_SETUP_TOKEN",
    "SMALLSASS_ACCOUNT_REQUIRE_MFA",
    "SMALLSASS_ACCOUNT_PASSWORD_BREACH_CHECK",
  ];
  if (
    hasConfiguredKey(environment, passwordKeys) ||
    source.CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD ||
    source.CAPACITYLENS_CREATE_ADMIN_ADMIN === "1"
  ) {
    throw new AccountConfigError("The hosted-oidc-only deployment profile refuses password-account configuration.");
  }
}

function assertHostedProfile(environment: AccountEnvironment, source: AccountEnvironment): void {
  const clientKeys = ["SMALLSASS_ACCOUNT_OIDC_CLIENT_ID", "SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET"];
  if (!clientKeys.every((key) => environment[key])) {
    throw new AccountConfigError("The hosted-oidc-only deployment profile requires an OIDC client id and secret.");
  }
  const discoveryKeys = ["SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL", "SMALLSASS_ACCOUNT_OIDC_ISSUER"];
  if (!discoveryKeys.every((key) => environment[key])) {
    throw new AccountConfigError(
      "The hosted-oidc-only deployment profile requires an explicit OIDC issuer and discovery metadata.",
    );
  }
  const scopes = (environment.SMALLSASS_ACCOUNT_OIDC_SCOPES ?? "openid profile email").split(/\s+/);
  const missingScopes = ["openid", "profile", "email"].filter((scope) => !scopes.includes(scope));
  if (missingScopes.length > 0) {
    throw new AccountConfigError(
      `The hosted-oidc-only deployment profile requires the ${missingScopes.join(", ")} scope${missingScopes.length === 1 ? "" : "s"}.`,
    );
  }
  if (hasConfiguredKey(environment, SOCIAL_PROVIDER_KEYS)) {
    throw new AccountConfigError(
      "The hosted-oidc-only deployment profile accepts only the configured strict OIDC provider.",
    );
  }
  if (environment.SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP === "1") {
    throw new AccountConfigError("The hosted-oidc-only deployment profile forbids open signup.");
  }
  assertHostedPasswordConfigurationAbsent(environment, source);
}

function assertProfileMode(profile: AccountDeploymentProfile, environment: AccountEnvironment): void {
  const capabilities = ACCOUNT_PROFILE_CAPABILITIES[profile];
  const requiredMode = capabilities.passwordSignIn ? "password" : "sso";
  if (environment.SMALLSASS_ACCOUNT_MODE === requiredMode) return;
  throw new AccountConfigError(
    capabilities.hosted
      ? "The hosted-oidc-only deployment profile requires SMALLSASS_ACCOUNT_MODE=sso; hosted password accounts are prohibited."
      : `The ${profile} deployment profile requires SMALLSASS_ACCOUNT_MODE=${requiredMode}.`,
  );
}

function assertProfileProviderPolicy(profile: AccountDeploymentProfile, environment: AccountEnvironment): void {
  const capabilities = ACCOUNT_PROFILE_CAPABILITIES[profile];
  if (!capabilities.strictOidc) {
    if (hasConfiguredKey(environment, EXTERNAL_IDENTITY_KEYS)) {
      throw new AccountConfigError("The self-hosted-password profile does not permit external identity providers.");
    }
    return;
  }
  const namedCompanyProvider =
    Boolean(environment.SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID && environment.SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET) ||
    Boolean(environment.SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID && environment.SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET);
  if (!namedCompanyProvider) {
    assertStrictOidcMaterial(
      environment,
      `${profile} requires a configured Google or Microsoft provider, or a strict OIDC client, issuer, and discovery document.`,
    );
  }
  if (!capabilities.passwordSignIn && environment.SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP === "1") {
    throw new AccountConfigError("The SSO-only deployment profile forbids open signup.");
  }
}

function assertDeploymentProfile(
  profile: AccountDeploymentProfile | null,
  environment: AccountEnvironment,
  source: AccountEnvironment,
): void {
  if (profile === null) return;
  const capabilities = ACCOUNT_PROFILE_CAPABILITIES[profile];
  assertProfileMode(profile, environment);
  if (capabilities.hosted) assertHostedProfile(environment, source);
  assertProfileProviderPolicy(profile, environment);
  if (environment.SMALLSASS_ACCOUNT_OIDC_AUTHORIZATION_URL || environment.SMALLSASS_ACCOUNT_OIDC_TOKEN_URL) {
    throw new AccountConfigError(
      "Named account profiles require discovery; explicit OIDC endpoint overrides are not accepted.",
    );
  }
}

/** Validate and normalize canonical account configuration once at composition time. */
export function resolveAccountEnvironment(source: Record<string, string | undefined>): ResolvedAccountEnvironment {
  // Startup resolves the family namespace before it opens storage, then passes that exact object
  // into the auth adapter. Keep resolution idempotent so the adapter can also safely accept the
  // normalized environment in tests and embedded callers.
  assertNoRetiredAccountNames(source);
  if (resolvedAccountEnvironments.has(source)) {
    return { env: source, profile: resolvedAccountEnvironments.get(source) ?? null };
  }
  const environment = resolveCanonicalSettings(source);
  if (environment.SMALLSASS_ACCOUNT_OIDC_BOOTSTRAP_EMAILS && environment.SMALLSASS_ACCOUNT_PROVIDER_BOOTSTRAP_EMAILS) {
    throw new AccountConfigError("Configure only one bootstrap address setting for each provider migration phase.");
  }
  const profile = readDeploymentProfile(source);
  assertDeploymentProfile(profile, environment, source);

  resolvedAccountEnvironments.set(environment, profile);
  return { env: environment, profile };
}
