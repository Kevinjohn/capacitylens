import { ACCOUNT_PROFILE_CAPABILITIES, isAccountDeploymentProfile } from "@capacitylens/shared/account/conformance";
import type { AccountDeploymentProfile } from "@capacitylens/shared/account/conformance";

export type { AccountDeploymentProfile } from "@capacitylens/shared/account/conformance";

export class AccountConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountConfigError";
  }
}

// Every live account setting whose value is trimmed (or, for the mode, refused when whitespace-only)
// before any parser reads it. Names outside this list are not account configuration.
const CANONICAL_ACCOUNT_NAMES: readonly string[] = [
  "CAPACITYLENS_MODE",
  "CAPACITYLENS_SECRET",
  "CAPACITYLENS_PUBLIC_URL",
  "CAPACITYLENS_SETUP_TOKEN",
  "CAPACITYLENS_ALLOW_OPEN_SIGNUP",
  "CAPACITYLENS_PASSWORD_BREACH_CHECK",
  "CAPACITYLENS_GOOGLE_CLIENT_ID",
  "CAPACITYLENS_GOOGLE_CLIENT_SECRET",
  "CAPACITYLENS_MICROSOFT_CLIENT_ID",
  "CAPACITYLENS_MICROSOFT_CLIENT_SECRET",
  "CAPACITYLENS_MICROSOFT_TENANT_ID",
  "CAPACITYLENS_GITHUB_CLIENT_ID",
  "CAPACITYLENS_GITHUB_CLIENT_SECRET",
  "CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS",
  "CAPACITYLENS_MAIL_HOST",
  "CAPACITYLENS_MAIL_PORT",
  "CAPACITYLENS_MAIL_USER",
  "CAPACITYLENS_MAIL_PASSWORD",
  "CAPACITYLENS_MAIL_FROM",
];

const SECRET_KEYS = new Set<string>([
  "CAPACITYLENS_SECRET",
  "CAPACITYLENS_SETUP_TOKEN",
  "CAPACITYLENS_GOOGLE_CLIENT_SECRET",
  "CAPACITYLENS_MICROSOFT_CLIENT_SECRET",
  "CAPACITYLENS_GITHUB_CLIENT_SECRET",
  "CAPACITYLENS_MAIL_PASSWORD",
]);

const resolvedAccountEnvironments = new WeakMap<object, AccountDeploymentProfile | null>();

function normalizeSetting(key: string, value: string): string {
  if (SECRET_KEYS.has(key)) return value;
  if (key === "CAPACITYLENS_MODE") return value.trim().toLowerCase();
  return value.trim();
}

function parseConfiguredValue(key: string, value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (value.trim() === "") {
    if (key === "CAPACITYLENS_MODE") {
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

function resolveCanonicalSettings(source: AccountEnvironment): AccountEnvironment {
  const environment = { ...source };
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
  const rawProfile = source.CAPACITYLENS_DEPLOYMENT_PROFILE?.trim();
  const profile = rawProfile === undefined || rawProfile === "" ? null : rawProfile;
  if (profile !== null && !isAccountDeploymentProfile(profile)) {
    throw new AccountConfigError(
      "CAPACITYLENS_DEPLOYMENT_PROFILE must be self-hosted-password, self-hosted-mixed, self-hosted-sso-only, or hosted-sso-only.",
    );
  }
  return profile;
}

const EXTERNAL_IDENTITY_KEYS = [
  "CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS",
  "CAPACITYLENS_MAIL_HOST",
  "CAPACITYLENS_MAIL_PORT",
  "CAPACITYLENS_MAIL_USER",
  "CAPACITYLENS_MAIL_PASSWORD",
  "CAPACITYLENS_MAIL_FROM",
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

function assertHostedPasswordConfigurationAbsent(environment: AccountEnvironment, source: AccountEnvironment): void {
  const passwordKeys = ["CAPACITYLENS_SETUP_TOKEN", "CAPACITYLENS_PASSWORD_BREACH_CHECK"];
  if (
    hasConfiguredKey(environment, passwordKeys) ||
    source.CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD ||
    source.CAPACITYLENS_CREATE_ADMIN_ADMIN === "1"
  ) {
    throw new AccountConfigError("The hosted-sso-only deployment profile refuses password-account configuration.");
  }
}

function assertHostedProfile(environment: AccountEnvironment, source: AccountEnvironment): void {
  if (environment.CAPACITYLENS_ALLOW_OPEN_SIGNUP === "1") {
    throw new AccountConfigError("The hosted-sso-only deployment profile forbids open signup.");
  }
  if (environment.CAPACITYLENS_GITHUB_CLIENT_ID || environment.CAPACITYLENS_GITHUB_CLIENT_SECRET) {
    throw new AccountConfigError("The hosted-sso-only deployment profile forbids GitHub configuration.");
  }
  assertHostedPasswordConfigurationAbsent(environment, source);
}

function assertProfileMode(profile: AccountDeploymentProfile, environment: AccountEnvironment): void {
  const capabilities = ACCOUNT_PROFILE_CAPABILITIES[profile];
  const requiredMode = {
    "self-hosted-password": "password-only",
    "self-hosted-mixed": "password-and-sso",
    "self-hosted-sso-only": "sso-only",
    "hosted-sso-only": "sso-only",
  }[profile];
  if (environment.CAPACITYLENS_MODE === requiredMode) return;
  throw new AccountConfigError(
    capabilities.hosted
      ? "The hosted-sso-only deployment profile requires CAPACITYLENS_MODE=sso-only; hosted password accounts are prohibited."
      : `The ${profile} deployment profile requires CAPACITYLENS_MODE=${requiredMode}.`,
  );
}

function assertProfileProviderPolicy(profile: AccountDeploymentProfile, environment: AccountEnvironment): void {
  const capabilities = ACCOUNT_PROFILE_CAPABILITIES[profile];
  if (profile === "self-hosted-password") {
    if (hasConfiguredKey(environment, EXTERNAL_IDENTITY_KEYS)) {
      throw new AccountConfigError("The self-hosted-password profile does not permit external identity providers.");
    }
    return;
  }
  const namedCompanyProvider =
    Boolean(environment.CAPACITYLENS_GOOGLE_CLIENT_ID && environment.CAPACITYLENS_GOOGLE_CLIENT_SECRET) ||
    Boolean(environment.CAPACITYLENS_MICROSOFT_CLIENT_ID && environment.CAPACITYLENS_MICROSOFT_CLIENT_SECRET);
  if (!namedCompanyProvider) {
    throw new AccountConfigError(`${profile} requires a configured Google or tenant-specific Microsoft provider.`);
  }
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
}

/** Validate and normalize canonical account configuration once at composition time. */
export function resolveAccountEnvironment(source: Record<string, string | undefined>): ResolvedAccountEnvironment {
  // Startup resolves the account namespace before it opens storage, then passes that exact object
  // into the auth adapter. Keep resolution idempotent so the adapter can also safely accept the
  // normalized environment in tests and embedded callers.
  if (resolvedAccountEnvironments.has(source)) {
    return { env: source, profile: resolvedAccountEnvironments.get(source) ?? null };
  }
  const environment = resolveCanonicalSettings(source);
  const profile = readDeploymentProfile(source);
  assertDeploymentProfile(profile, environment, source);

  resolvedAccountEnvironments.set(environment, profile);
  return { env: environment, profile };
}
