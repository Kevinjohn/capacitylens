import { authClient } from "./authClient";
import { buildExternalSignInErrorUrl } from "./externalSignInError";
import type { AuthProviderInfo } from "./authContext";

// Keep provider dispatch inside lazy authentication entry points so importing the shared operation does not load the auth client in the initial bundle.

/** Starts a configured provider flow with the current URL as the success target and a marked
 * failure-return URL. The caller owns navigation and its busy/error state. */
export function dispatchExternalProviderSignIn(provider: AuthProviderInfo) {
  return authClient.signIn.social({
    provider: provider.id,
    callbackURL: window.location.href,
    errorCallbackURL: buildExternalSignInErrorUrl(window.location.href),
  });
}
