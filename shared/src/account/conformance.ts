/**
 * Version markers carried by implementations and CI evidence.
 *
 * They are repository-local until a second consumer triggers package promotion. At that review the
 * same values become package metadata; consumers must never infer security currency from the
 * product version alone.
 */
export const ACCOUNT_CONTRACT_VERSION = "2.0.0";
/** Version of the account conformance suite an adapter must pass. */
export const ACCOUNT_CONFORMANCE_VERSION = "2.1.0";
/** Lowest account security baseline version an adapter may declare. */
export const MINIMUM_ACCOUNT_SECURITY_VERSION = "1.1.0";
/** Identifier of the account security baseline this contract version enforces. */
export const ACCOUNT_SECURITY_BASELINE_ID = "ACCOUNT-SEC-2026-08-07-01";

/** Every supported account deployment profile. */
export const ACCOUNT_DEPLOYMENT_PROFILES = Object.freeze([
  "self-hosted-password",
  "self-hosted-mixed",
  "self-hosted-sso-only",
  "hosted-sso-only",
] as const);

/** A supported account deployment profile; see {@link ACCOUNT_DEPLOYMENT_PROFILES}. */
export type AccountDeploymentProfile = (typeof ACCOUNT_DEPLOYMENT_PROFILES)[number];

/** Narrow an untrusted value to a known {@link AccountDeploymentProfile}. Pure. */
export function isAccountDeploymentProfile(value: unknown): value is AccountDeploymentProfile {
  return typeof value === "string" && (ACCOUNT_DEPLOYMENT_PROFILES as readonly string[]).includes(value);
}

/** What a deployment profile permits: password sign-in, a required company provider, hosting. */
export interface AccountProfileCapabilities {
  readonly passwordSignIn: boolean;
  readonly companyProviderRequired: boolean;
  readonly hosted: boolean;
}

/** The capabilities of each deployment profile. */
export const ACCOUNT_PROFILE_CAPABILITIES: Readonly<Record<AccountDeploymentProfile, AccountProfileCapabilities>> =
  Object.freeze({
    "self-hosted-password": Object.freeze({ passwordSignIn: true, companyProviderRequired: false, hosted: false }),
    "self-hosted-mixed": Object.freeze({ passwordSignIn: true, companyProviderRequired: true, hosted: false }),
    "self-hosted-sso-only": Object.freeze({ passwordSignIn: false, companyProviderRequired: true, hosted: false }),
    "hosted-sso-only": Object.freeze({ passwordSignIn: false, companyProviderRequired: true, hosted: true }),
  });
