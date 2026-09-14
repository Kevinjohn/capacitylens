import type { SocialProviders } from "better-auth/social-providers";
import { resolveAccountConfigKey } from "../accountConfig";
import type { AuthConfigError } from "../auth";
import { mapExternalAvatar } from "./betterAuthProfileCompatibility";

type Env = Record<string, string | undefined>;
type AuthConfigErrorConstructor = typeof AuthConfigError;

function resolveMicrosoftTenantId(value: string | undefined): string {
  return value === undefined || value === "" ? "common" : value;
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
  if (!id || !secret)
    throw new ErrorType(
      `${resolveAccountConfigKey(idKey)} and ${resolveAccountConfigKey(secretKey)} must both be set to enable ${label}.`,
    );
  return [id, secret];
}

/** Assemble configured native social providers with safe avatar claim projection. */
export function parseSocialProvidersFromEnvironment(
  environment: Env,
  ErrorType: AuthConfigErrorConstructor,
): SocialProviders {
  const providers: SocialProviders = {};
  const pair = (idKey: string, secretKey: string, label: string) =>
    parseCredentialPair({ environment, idKey, secretKey, label, ErrorType });
  const google = pair("CAPACITYLENS_GOOGLE_CLIENT_ID", "CAPACITYLENS_GOOGLE_CLIENT_SECRET", "Google sign-in");
  if (google)
    providers.google = {
      clientId: google[0],
      clientSecret: google[1],
      overrideUserInfoOnSignIn: true,
      mapProfileToUser: (profile) => mapExternalAvatar(profile.picture),
    };
  const microsoft = pair(
    "CAPACITYLENS_MICROSOFT_CLIENT_ID",
    "CAPACITYLENS_MICROSOFT_CLIENT_SECRET",
    "Microsoft sign-in",
  );
  if (microsoft)
    providers.microsoft = {
      clientId: microsoft[0],
      clientSecret: microsoft[1],
      overrideUserInfoOnSignIn: true,
      mapProfileToUser: (profile) => mapExternalAvatar(profile.picture),
      tenantId: resolveMicrosoftTenantId(environment.CAPACITYLENS_MICROSOFT_TENANT_ID),
    };
  const github = pair("CAPACITYLENS_GITHUB_CLIENT_ID", "CAPACITYLENS_GITHUB_CLIENT_SECRET", "GitHub sign-in");
  if (github)
    providers.github = {
      clientId: github[0],
      clientSecret: github[1],
      overrideUserInfoOnSignIn: true,
      mapProfileToUser: (profile) => mapExternalAvatar(profile.avatar_url),
    };
  return providers;
}
