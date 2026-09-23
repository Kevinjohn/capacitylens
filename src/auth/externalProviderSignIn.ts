import { authClient } from "./authClient";
import { buildExternalSignInErrorUrl } from "./externalSignInError";
import type { AuthProviderInfo } from "./authContext";

// Only imported from LoginScreen.tsx and ReauthDialog.tsx — both are React.lazy chunks in
// AuthProvider, and importing authClient here (the same way those two files already do) keeps this
// module inside the same lazy-loading boundary: Better Auth's client still never enters the main
// bundle just because sign-in/re-auth dispatch was factored out.

/** The one piece both LoginScreen's initial sign-in and ReauthDialog's step-up re-auth share:
 *  starting an external provider flow with the current URL as the redirect target on success and
 *  a marked failure-return URL otherwise. Better Auth 1.7 routes generic OAuth providers through
 *  signIn.social alongside native social providers. Callers keep their own busy/error state
 *  handling and result interpretation — this only returns whatever Better Auth returned. */
export function dispatchExternalProviderSignIn(provider: AuthProviderInfo) {
  return authClient.signIn.social({
    provider: provider.id,
    callbackURL: window.location.href,
    errorCallbackURL: buildExternalSignInErrorUrl(window.location.href),
  });
}
