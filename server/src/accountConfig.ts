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

const ALIASES = {
  SMALLSASS_ACCOUNT_MODE: "CAPACITYLENS_AUTH",
  SMALLSASS_ACCOUNT_SECRET: "BETTER_AUTH_SECRET",
  SMALLSASS_ACCOUNT_PUBLIC_URL: "BETTER_AUTH_URL",
  SMALLSASS_ACCOUNT_SETUP_TOKEN: "CAPACITYLENS_SETUP_TOKEN",
  SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP: "CAPACITYLENS_ALLOW_OPEN_SIGNUP",
  SMALLSASS_ACCOUNT_REQUIRE_MFA: "CAPACITYLENS_REQUIRE_MFA",
  SMALLSASS_ACCOUNT_PASSWORD_BREACH_CHECK: "CAPACITYLENS_PASSWORD_BREACH_CHECK",
  SMALLSASS_ACCOUNT_SSO_MFA_ENFORCED: "CAPACITYLENS_SSO_MFA_ENFORCED",
  SMALLSASS_ACCOUNT_OIDC_CLIENT_ID: "CAPACITYLENS_SSO_CLIENT_ID",
  SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET: "CAPACITYLENS_SSO_CLIENT_SECRET",
  SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL: "CAPACITYLENS_SSO_DISCOVERY_URL",
  SMALLSASS_ACCOUNT_OIDC_ISSUER: "CAPACITYLENS_SSO_ISSUER",
  SMALLSASS_ACCOUNT_OIDC_AUTHORIZATION_URL: "CAPACITYLENS_SSO_AUTHORIZATION_URL",
  SMALLSASS_ACCOUNT_OIDC_TOKEN_URL: "CAPACITYLENS_SSO_TOKEN_URL",
  SMALLSASS_ACCOUNT_OIDC_SCOPES: "CAPACITYLENS_SSO_SCOPES",
  SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID: "CAPACITYLENS_SSO_PROVIDER_ID",
  SMALLSASS_ACCOUNT_OIDC_LABEL: "CAPACITYLENS_SSO_LABEL",
  SMALLSASS_ACCOUNT_OIDC_BOOTSTRAP_EMAILS: "CAPACITYLENS_SSO_BOOTSTRAP_EMAILS",
  SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "CAPACITYLENS_GOOGLE_CLIENT_ID",
  SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "CAPACITYLENS_GOOGLE_CLIENT_SECRET",
  SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID: "CAPACITYLENS_MICROSOFT_CLIENT_ID",
  SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET: "CAPACITYLENS_MICROSOFT_CLIENT_SECRET",
  SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID: "CAPACITYLENS_MICROSOFT_TENANT_ID",
  SMALLSASS_ACCOUNT_GITHUB_CLIENT_ID: "CAPACITYLENS_GITHUB_CLIENT_ID",
  SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET: "CAPACITYLENS_GITHUB_CLIENT_SECRET",
} as const;

const CANONICAL_BY_COMPATIBILITY_KEY = new Map<string, string>(
  Object.entries(ALIASES).map(([canonical, compatibility]) => [compatibility, canonical]),
);

/** Operator-facing name for an account setting consumed through the compatibility adapter. */
export function resolveAccountConfigKey(key: string): string {
  return CANONICAL_BY_COMPATIBILITY_KEY.get(key) ?? key;
}

const SECRET_KEYS = new Set<string>([
  "SMALLSASS_ACCOUNT_SECRET",
  "SMALLSASS_ACCOUNT_SETUP_TOKEN",
  "SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET",
  "SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET",
  "SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET",
  "SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET",
]);

let warnedAliasesBySource = new WeakMap<object, Set<string>>();
const resolvedAccountEnvironments = new WeakMap<object, AccountDeploymentProfile | null>();

interface WarnLegacyAliasInput {
  source: object;
  legacy: string;
  canonical: string;
  warn: (message: string) => void;
}

function warnLegacyAlias({ source, legacy, canonical, warn }: WarnLegacyAliasInput): void {
  let warnedAliases = warnedAliasesBySource.get(source);
  if (!warnedAliases) {
    warnedAliases = new Set();
    warnedAliasesBySource.set(source, warnedAliases);
  }
  if (warnedAliases.has(legacy)) return;
  warn(`account configuration: ${legacy} is deprecated; use ${canonical}.`);
  warnedAliases.add(legacy);
}

function normalizeSettingForComparison(key: string, value: string): string {
  if (SECRET_KEYS.has(key)) return value;
  if (key === "SMALLSASS_ACCOUNT_MODE") return value.trim().toLowerCase();
  if (key === "SMALLSASS_ACCOUNT_OIDC_SCOPES") return value.trim().split(/\s+/).join(" ");
  return value.trim();
}

function parseConfiguredValue(key: string, value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (value.trim() === "") {
    if (key === "SMALLSASS_ACCOUNT_MODE" || key === "CAPACITYLENS_AUTH") {
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

function resolveAliases(source: AccountEnvironment, warn: (message: string) => void): AccountEnvironment {
  const environment = { ...source };
  for (const [canonical, legacy] of Object.entries(ALIASES)) {
    const canonicalValue = parseConfiguredValue(canonical, source[canonical]);
    const legacyValue = parseConfiguredValue(legacy, source[legacy]);
    if (
      canonicalValue !== undefined &&
      legacyValue !== undefined &&
      normalizeSettingForComparison(canonical, canonicalValue) !== normalizeSettingForComparison(canonical, legacyValue)
    ) {
      throw new AccountConfigError(
        `${canonical} conflicts with its legacy alias ${legacy}; refusing to choose a security posture.`,
      );
    }
    const resolvedValue = canonicalValue ?? legacyValue;
    if (resolvedValue === undefined) {
      delete environment[canonical];
      delete environment[legacy];
      continue;
    }
    if (legacyValue !== undefined) warnLegacyAlias({ source, legacy, canonical, warn });
    environment[canonical] = normalizeSettingForComparison(canonical, resolvedValue);
    environment[legacy] = environment[canonical];
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
  "CAPACITYLENS_SSO_CLIENT_ID",
  "CAPACITYLENS_SSO_CLIENT_SECRET",
  "CAPACITYLENS_SSO_DISCOVERY_URL",
  "CAPACITYLENS_SSO_ISSUER",
  "CAPACITYLENS_SSO_AUTHORIZATION_URL",
  "CAPACITYLENS_SSO_TOKEN_URL",
  "CAPACITYLENS_SSO_SCOPES",
  "CAPACITYLENS_SSO_PROVIDER_ID",
  "CAPACITYLENS_SSO_LABEL",
  "CAPACITYLENS_SSO_BOOTSTRAP_EMAILS",
  "CAPACITYLENS_GOOGLE_CLIENT_ID",
  "CAPACITYLENS_GOOGLE_CLIENT_SECRET",
  "CAPACITYLENS_MICROSOFT_CLIENT_ID",
  "CAPACITYLENS_MICROSOFT_CLIENT_SECRET",
  "CAPACITYLENS_MICROSOFT_TENANT_ID",
  "CAPACITYLENS_GITHUB_CLIENT_ID",
  "CAPACITYLENS_GITHUB_CLIENT_SECRET",
] as const;

function hasConfiguredKey(environment: AccountEnvironment, keys: readonly string[]): boolean {
  return keys.some((key) => environment[key] !== undefined);
}

function assertStrictOidcMaterial(environment: AccountEnvironment, message: string): void {
  const requiredKeys = [
    "CAPACITYLENS_SSO_CLIENT_ID",
    "CAPACITYLENS_SSO_CLIENT_SECRET",
    "CAPACITYLENS_SSO_DISCOVERY_URL",
    "CAPACITYLENS_SSO_ISSUER",
  ];
  if (!requiredKeys.every((key) => environment[key])) throw new AccountConfigError(message);
}

function assertHostedPasswordConfigurationAbsent(environment: AccountEnvironment, source: AccountEnvironment): void {
  const passwordKeys = ["CAPACITYLENS_SETUP_TOKEN", "CAPACITYLENS_REQUIRE_MFA", "CAPACITYLENS_PASSWORD_BREACH_CHECK"];
  if (
    hasConfiguredKey(environment, passwordKeys) ||
    source.CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD ||
    source.CAPACITYLENS_CREATE_ADMIN_ADMIN === "1"
  ) {
    throw new AccountConfigError("The hosted-oidc-only deployment profile refuses password-account configuration.");
  }
}

function assertHostedProfile(environment: AccountEnvironment, source: AccountEnvironment): void {
  const clientKeys = ["CAPACITYLENS_SSO_CLIENT_ID", "CAPACITYLENS_SSO_CLIENT_SECRET"];
  if (!clientKeys.every((key) => environment[key])) {
    throw new AccountConfigError("The hosted-oidc-only deployment profile requires an OIDC client id and secret.");
  }
  const discoveryKeys = ["CAPACITYLENS_SSO_DISCOVERY_URL", "CAPACITYLENS_SSO_ISSUER"];
  if (!discoveryKeys.every((key) => environment[key])) {
    throw new AccountConfigError(
      "The hosted-oidc-only deployment profile requires an explicit OIDC issuer and discovery metadata.",
    );
  }
  const scopes = (environment.CAPACITYLENS_SSO_SCOPES ?? "openid profile email").split(/\s+/);
  const missingScopes = ["openid", "profile", "email"].filter((scope) => !scopes.includes(scope));
  if (missingScopes.length > 0) {
    throw new AccountConfigError(
      `The hosted-oidc-only deployment profile requires the ${missingScopes.join(", ")} scope${missingScopes.length === 1 ? "" : "s"}.`,
    );
  }
  const socialProviderKeys = EXTERNAL_IDENTITY_KEYS.slice(10);
  if (hasConfiguredKey(environment, socialProviderKeys)) {
    throw new AccountConfigError(
      "The hosted-oidc-only deployment profile accepts only the configured strict OIDC provider.",
    );
  }
  if (environment.CAPACITYLENS_ALLOW_OPEN_SIGNUP === "1") {
    throw new AccountConfigError("The hosted-oidc-only deployment profile forbids open signup.");
  }
  assertHostedPasswordConfigurationAbsent(environment, source);
}

function assertProfileMode(profile: AccountDeploymentProfile, environment: AccountEnvironment): void {
  const capabilities = ACCOUNT_PROFILE_CAPABILITIES[profile];
  const requiredMode = capabilities.passwordSignIn ? "password" : "sso";
  if (environment.CAPACITYLENS_AUTH === requiredMode) return;
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
  assertStrictOidcMaterial(environment, `${profile} requires a strict OIDC client, issuer, and discovery document.`);
  if (!capabilities.passwordSignIn && environment.CAPACITYLENS_ALLOW_OPEN_SIGNUP === "1") {
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
  if (environment.CAPACITYLENS_SSO_AUTHORIZATION_URL || environment.CAPACITYLENS_SSO_TOKEN_URL) {
    throw new AccountConfigError(
      "Named account profiles require discovery; explicit OIDC endpoint overrides are not accepted.",
    );
  }
}

/** Resolve canonical family configuration and legacy aliases exactly once at composition time. */
export function resolveAccountEnvironment(
  source: Record<string, string | undefined>,
  options: { warn?: (message: string) => void } = {},
): ResolvedAccountEnvironment {
  // Startup resolves the family namespace before it opens storage, then passes that exact object
  // into the auth adapter. Keep resolution idempotent so the adapter can also safely accept raw
  // environments in tests and embedded callers without reinterpreting generated compatibility
  // aliases as operator-supplied deprecated settings.
  if (resolvedAccountEnvironments.has(source)) {
    return { env: source, profile: resolvedAccountEnvironments.get(source) ?? null };
  }
  const warn =
    options.warn ??
    ((message: string) => {
      if (source.NODE_ENV !== "test") console.warn(message);
    });
  const environment = resolveAliases(source, warn);
  const profile = readDeploymentProfile(source);
  assertDeploymentProfile(profile, environment, source);

  resolvedAccountEnvironments.set(environment, profile);
  return { env: environment, profile };
}

export function resetAccountConfigWarningStateForTests(): void {
  warnedAliasesBySource = new WeakMap();
}
