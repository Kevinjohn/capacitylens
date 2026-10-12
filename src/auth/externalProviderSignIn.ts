import { authClient } from "./authClient";
import { buildExternalSignInErrorUrl } from "./externalSignInError";
import type { AuthProviderInfo } from "./authContext";

// Keep provider dispatch inside lazy authentication entry points so importing the shared operation does not load the auth client in the initial bundle.

/** The one piece both LoginScreen's initial sign-in and ReauthDialog's step-up re-auth share:
 * starting an external provider flow with the current URL as the redirect target on success and
 * a marked failure-return URL otherwise. Better Auth 1.7 routes generic OAuth providers through
 * signIn.social alongside native social providers. Callers keep their own busy/error state
 * handling and result interpretation. This only returns whatever Better Auth returned. */
export function dispatchExternalProviderSignIn(provider: AuthProviderInfo) {
  return authClient.signIn.social({
    provider: provider.id,
    callbackURL: window.location.href,
    errorCallbackURL: buildExternalSignInErrorUrl(window.location.href),
  });
}
