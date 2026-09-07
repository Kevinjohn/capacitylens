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
  const environment = { ...source };
  const warn =
    options.warn ??
    ((message: string) => {
      if (source.NODE_ENV !== "test") console.warn(message);
    });
  for (const [canonical, legacy] of Object.entries(ALIASES)) {
    // Compose commonly materializes unset interpolation as an empty string. Treat that as absent
    // so an empty canonical placeholder cannot conflict with (or erase) a real compatibility
    // alias supplied by an existing deployment.
    const canonicalValue = parseConfiguredValue(canonical, source[canonical]);
    const legacyValue = parseConfiguredValue(legacy, source[legacy]);
    if (canonicalValue !== undefined && legacyValue !== undefined) {
      if (
        normalizeSettingForComparison(canonical, canonicalValue) !==
        normalizeSettingForComparison(canonical, legacyValue)
      ) {
        throw new AccountConfigError(
          `${canonical} conflicts with its legacy alias ${legacy}; refusing to choose a security posture.`,
        );
      }
      warnLegacyAlias({ source, legacy, canonical, warn });
      environment[canonical] = normalizeSettingForComparison(canonical, canonicalValue);
      environment[legacy] = environment[canonical];
    } else if (canonicalValue !== undefined) {
      environment[canonical] = normalizeSettingForComparison(canonical, canonicalValue);
      environment[legacy] = environment[canonical];
    } else if (legacyValue !== undefined) {
      warnLegacyAlias({ source, legacy, canonical, warn });
      environment[canonical] = normalizeSettingForComparison(canonical, legacyValue);
      environment[legacy] = environment[canonical];
    } else {
      delete environment[canonical];
      delete environment[legacy];
    }
  }

  const rawProfile = source.SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE?.trim();
  const profile = rawProfile === undefined || rawProfile === "" ? null : rawProfile;
  if (profile !== null && !isAccountDeploymentProfile(profile)) {
    throw new AccountConfigError(
      "SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE must be self-hosted-password, self-hosted-mixed, self-hosted-sso-only, or hosted-oidc-only.",
    );
  }

  const capabilities = profile === null ? null : ACCOUNT_PROFILE_CAPABILITIES[profile];
  if (capabilities) {
    const requiredMode = capabilities.passwordSignIn ? "password" : "sso";
    if (environment.CAPACITYLENS_AUTH !== requiredMode) {
      throw new AccountConfigError(
        capabilities.hosted
          ? "The hosted-oidc-only deployment profile requires SMALLSASS_ACCOUNT_MODE=sso; hosted password accounts are prohibited."
          : `The ${profile} deployment profile requires SMALLSASS_ACCOUNT_MODE=${requiredMode}.`,
      );
    }
  }

  if (capabilities?.hosted) {
    if (!environment.CAPACITYLENS_SSO_CLIENT_ID || !environment.CAPACITYLENS_SSO_CLIENT_SECRET) {
      throw new AccountConfigError("The hosted-oidc-only deployment profile requires an OIDC client id and secret.");
    }
    if (!environment.CAPACITYLENS_SSO_DISCOVERY_URL || !environment.CAPACITYLENS_SSO_ISSUER) {
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
    if (
      environment.CAPACITYLENS_GOOGLE_CLIENT_ID ||
      environment.CAPACITYLENS_GOOGLE_CLIENT_SECRET ||
      environment.CAPACITYLENS_MICROSOFT_CLIENT_ID ||
      environment.CAPACITYLENS_MICROSOFT_CLIENT_SECRET ||
      environment.CAPACITYLENS_MICROSOFT_TENANT_ID ||
      environment.CAPACITYLENS_GITHUB_CLIENT_ID ||
      environment.CAPACITYLENS_GITHUB_CLIENT_SECRET
    ) {
      throw new AccountConfigError(
        "The hosted-oidc-only deployment profile accepts only the configured strict OIDC provider.",
      );
    }
    if (environment.CAPACITYLENS_ALLOW_OPEN_SIGNUP === "1") {
      throw new AccountConfigError("The hosted-oidc-only deployment profile forbids open signup.");
    }
    if (
      environment.CAPACITYLENS_SETUP_TOKEN ||
      environment.CAPACITYLENS_REQUIRE_MFA ||
      environment.CAPACITYLENS_PASSWORD_BREACH_CHECK ||
      source.CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD ||
      source.CAPACITYLENS_CREATE_ADMIN_ADMIN === "1"
    ) {
      throw new AccountConfigError("The hosted-oidc-only deployment profile refuses password-account configuration.");
    }
  }
  if (
    capabilities !== null &&
    !capabilities.strictOidc &&
    (environment.CAPACITYLENS_SSO_CLIENT_ID ||
      environment.CAPACITYLENS_SSO_CLIENT_SECRET ||
      environment.CAPACITYLENS_SSO_DISCOVERY_URL ||
      environment.CAPACITYLENS_SSO_ISSUER ||
      environment.CAPACITYLENS_SSO_AUTHORIZATION_URL ||
      environment.CAPACITYLENS_SSO_TOKEN_URL ||
      environment.CAPACITYLENS_SSO_SCOPES ||
      environment.CAPACITYLENS_SSO_PROVIDER_ID ||
      environment.CAPACITYLENS_SSO_LABEL ||
      environment.CAPACITYLENS_SSO_BOOTSTRAP_EMAILS ||
      environment.CAPACITYLENS_GOOGLE_CLIENT_ID ||
      environment.CAPACITYLENS_GOOGLE_CLIENT_SECRET ||
      environment.CAPACITYLENS_MICROSOFT_CLIENT_ID ||
      environment.CAPACITYLENS_MICROSOFT_CLIENT_SECRET ||
      environment.CAPACITYLENS_MICROSOFT_TENANT_ID ||
      environment.CAPACITYLENS_GITHUB_CLIENT_ID ||
      environment.CAPACITYLENS_GITHUB_CLIENT_SECRET)
  ) {
    throw new AccountConfigError("The self-hosted-password profile does not permit external identity providers.");
  }
  if (capabilities?.strictOidc && !capabilities.hosted) {
    if (
      !environment.CAPACITYLENS_SSO_CLIENT_ID ||
      !environment.CAPACITYLENS_SSO_CLIENT_SECRET ||
      !environment.CAPACITYLENS_SSO_DISCOVERY_URL ||
      !environment.CAPACITYLENS_SSO_ISSUER
    ) {
      throw new AccountConfigError(`${profile} requires a strict OIDC client, issuer, and discovery document.`);
    }
    if (!capabilities.passwordSignIn) {
      if (environment.CAPACITYLENS_ALLOW_OPEN_SIGNUP === "1") {
        throw new AccountConfigError("The SSO-only deployment profile forbids open signup.");
      }
    }
  }
  if (profile !== null && (environment.CAPACITYLENS_SSO_AUTHORIZATION_URL || environment.CAPACITYLENS_SSO_TOKEN_URL)) {
    throw new AccountConfigError(
      "Named account profiles require discovery; explicit OIDC endpoint overrides are not accepted.",
    );
  }

  resolvedAccountEnvironments.set(environment, profile);
  return { env: environment, profile };
}

export function resetAccountConfigWarningStateForTests(): void {
  warnedAliasesBySource = new WeakMap();
}
