import { afterEach, describe, expect, it, vi } from "vitest";

// Same mocking style as LoginScreen.test.tsx / ReauthDialog.test.tsx: authClient is Better Auth's
// client, isolated so this test never talks to a real server.
const signInOauth2 = vi.fn();
const signInSocial = vi.fn();
vi.mock("./authClient", () => ({
  authClient: {
    signIn: {
      oauth2: (...args: unknown[]) => signInOauth2(...args),
      social: (...args: unknown[]) => signInSocial(...args),
    },
  },
}));

import { dispatchExternalProviderSignIn } from "./externalProviderSignIn";
import type { AuthProviderInfo } from "./authContext";

afterEach(() => {
  signInOauth2.mockReset();
  signInSocial.mockReset();
  window.history.replaceState({}, "", "/");
});

describe("dispatchExternalProviderSignIn", () => {
  it("dispatches an oidc-kind provider through signIn.oauth2 with the marked callback URLs", async () => {
    window.history.replaceState({}, "", "/team?tab=access");
    const outcome = { data: {}, error: null };
    signInOauth2.mockResolvedValue(outcome);
    const provider: AuthProviderInfo = { id: "sso", label: "Single sign-on", kind: "oidc", experimental: false };

    const result = await dispatchExternalProviderSignIn(provider);

    expect(signInOauth2).toHaveBeenCalledWith({
      providerId: "sso",
      callbackURL: "http://localhost:3000/team?tab=access",
      errorCallbackURL: "http://localhost:3000/team?tab=access&externalSignInError=1",
    });
    expect(signInSocial).not.toHaveBeenCalled();
    expect(result).toBe(outcome);
  });

  it("dispatches a social-kind provider through signIn.social with the marked callback URLs", async () => {
    window.history.replaceState({}, "", "/invite/token?source=mail");
    const outcome = { data: {}, error: null };
    signInSocial.mockResolvedValue(outcome);
    const provider: AuthProviderInfo = { id: "google", label: "Google", kind: "social", experimental: true };

    const result = await dispatchExternalProviderSignIn(provider);

    expect(signInSocial).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "http://localhost:3000/invite/token?source=mail",
      errorCallbackURL: "http://localhost:3000/invite/token?source=mail&externalSignInError=1",
    });
    expect(signInOauth2).not.toHaveBeenCalled();
    expect(result).toBe(outcome);
  });
});
