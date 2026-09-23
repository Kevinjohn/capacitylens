import { isLoopbackHostname } from "../strictOidc";
import type * as AuthFacade from "../auth";

type AuthConfigError = typeof AuthFacade.AuthConfigError;

function requireProductionTls(
  publicUrl: URL,
  runtimeEnvironment: string | undefined,
  AuthConfigError: AuthConfigError,
): void {
  if (
    runtimeEnvironment === "production" &&
    publicUrl.protocol !== "https:" &&
    !isLoopbackHostname(publicUrl.hostname)
  ) {
    throw new AuthConfigError(
      "SMALLSASS_ACCOUNT_PUBLIC_URL must use https:// for a non-loopback production origin; credentials and session cookies must not cross plaintext HTTP.",
    );
  }
}

export function parsePublicUrl(
  baseURL: string,
  runtimeEnvironment: string | undefined,
  AuthConfigError: AuthConfigError,
): URL {
  let publicUrl: URL;
  try {
    publicUrl = new URL(baseURL);
  } catch (cause) {
    throw new AuthConfigError("SMALLSASS_ACCOUNT_PUBLIC_URL must be an absolute http:// or https:// URL.", { cause });
  }
  if (publicUrl.protocol !== "http:" && publicUrl.protocol !== "https:") {
    throw new AuthConfigError("SMALLSASS_ACCOUNT_PUBLIC_URL must use http:// or https://.");
  }
  if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) {
    throw new AuthConfigError(
      "SMALLSASS_ACCOUNT_PUBLIC_URL must be an origin without credentials, a query string, or a fragment.",
    );
  }
  if (publicUrl.pathname !== "/" && publicUrl.pathname !== "") {
    throw new AuthConfigError("SMALLSASS_ACCOUNT_PUBLIC_URL must be an origin without a path.");
  }
  requireProductionTls(publicUrl, runtimeEnvironment, AuthConfigError);
  return publicUrl;
}
