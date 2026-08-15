import { m } from "@/i18n";

const MARKER = "externalSignInError";
const PROVIDER_ERROR = "error";
const PROVIDER_DESCRIPTION = "error_description";
const PROVIDER_ERROR_URI = "error_uri";

/** Return an application URL that an identity adapter may use for browser-visible callback errors. */
export function externalSignInErrorUrl(currentUrl: string): string {
  const url = new URL(currentUrl);
  url.searchParams.set(MARKER, "1");
  url.searchParams.delete(PROVIDER_ERROR);
  url.searchParams.delete(PROVIDER_DESCRIPTION);
  url.searchParams.delete(PROVIDER_ERROR_URI);
  return url.toString();
}

/** Recognize only errors routed through our marked callback URL, not arbitrary product query data. */
export function hasExternalSignInError(url: string): boolean {
  const parsed = new URL(url);
  return parsed.searchParams.get(MARKER) === "1";
}

/** Stable application-owned provider failure categories safe to show in browser copy. */
export type ExternalSignInErrorCode = "oidc_verification_failed" | "account_link_conflict";

/** Map only application-owned callback codes; provider-controlled values remain untrusted. */
export function externalSignInErrorCode(url: string): ExternalSignInErrorCode | null {
  const parsed = new URL(url);
  if (parsed.searchParams.get(MARKER) !== "1") return null;
  const code = parsed.searchParams.get(PROVIDER_ERROR);
  if (code === "OIDC_IDENTITY_VERIFICATION_FAILED") return "oidc_verification_failed";
  if (code === "account_already_linked_to_different_user" || code === "account_link_conflict") {
    return "account_link_conflict";
  }
  return null;
}

/** Map an application-owned failure code (or its absence) to the stable, non-sensitive message shown
 *  to the user — the one mapping shared by AuthProvider's post-session failure host and LoginScreen's
 *  pre-session initial error state. Calls m.login_sso_*() at call time, same as both former inline
 *  copies — never cache the result across renders. */
export function externalSignInErrorMessage(code: ExternalSignInErrorCode | null): string {
  if (code === "oidc_verification_failed") return m.login_sso_verification_failed();
  if (code === "account_link_conflict") return m.login_sso_account_link_conflict();
  return m.login_sso_failed();
}

/** Remove provider-controlled error fields after rendering a stable, non-sensitive message. */
export function clearExternalSignInError(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete(MARKER);
  parsed.searchParams.delete(PROVIDER_ERROR);
  parsed.searchParams.delete(PROVIDER_DESCRIPTION);
  parsed.searchParams.delete(PROVIDER_ERROR_URI);
  return parsed.toString();
}
