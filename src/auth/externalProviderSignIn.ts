import { authClient } from "./authClient";
import { externalSignInErrorUrl } from "./externalSignInError";
import type { AuthProviderInfo } from "./authContext";

// Only imported from LoginScreen.tsx and ReauthDialog.tsx — both are React.lazy chunks in
// AuthProvider, and importing authClient here (the same way those two files already do) keeps this
// module inside the same lazy-loading boundary: Better Auth's client still never enters the main
// bundle just because sign-in/re-auth dispatch was factored out.

/** The one piece both LoginScreen's initial sign-in and ReauthDialog's step-up re-auth share:
 *  choosing the Better Auth call for an OIDC vs. a social provider, with the current URL as the
 *  redirect target on success and a marked failure-return URL otherwise. Callers keep their own
 *  busy/error state handling and result interpretation — this only returns whatever Better Auth
 *  returned. */
export function dispatchExternalProviderSignIn(provider: AuthProviderInfo) {
  return provider.kind === "oidc"
    ? authClient.signIn.oauth2({
        providerId: provider.id,
        callbackURL: window.location.href,
        errorCallbackURL: externalSignInErrorUrl(window.location.href),
      })
    : authClient.signIn.social({
        provider: provider.id,
        callbackURL: window.location.href,
        errorCallbackURL: externalSignInErrorUrl(window.location.href),
      });
}
