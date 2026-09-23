import { afterEach, describe, expect, it, vi } from "vitest";

// Same mocking style as LoginScreen.test.tsx / ReauthDialog.test.tsx: authClient is Better Auth's
// client, isolated so this test never talks to a real server.
const signInSocial = vi.fn();
vi.mock("./authClient", () => ({
  authClient: {
    signIn: {
      social: (...args: unknown[]) => signInSocial(...args),
    },
  },
}));

import { dispatchExternalProviderSignIn } from "./externalProviderSignIn";
import type { AuthProviderInfo } from "./authContext";

afterEach(() => {
  signInSocial.mockReset();
  window.history.replaceState({}, "", "/");
});

describe("dispatchExternalProviderSignIn", () => {
  it("dispatches Microsoft through signIn.social with the marked callback URLs", async () => {
    window.history.replaceState({}, "", "/team?tab=access");
    const outcome = { data: {}, error: null };
    signInSocial.mockResolvedValue(outcome);
    const provider: AuthProviderInfo = { id: "microsoft", label: "Microsoft", kind: "social", experimental: false };

    const result = await dispatchExternalProviderSignIn(provider);

    expect(signInSocial).toHaveBeenCalledWith({
      provider: "microsoft",
      callbackURL: "http://localhost:3000/team?tab=access",
      errorCallbackURL: "http://localhost:3000/team?tab=access&externalSignInError=1",
    });
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
    expect(result).toBe(outcome);
  });
});
