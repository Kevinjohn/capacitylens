import { describe, expect, it, vi } from "vitest";
import { parseAuthProviders } from "./authStatus";

describe("parseAuthProviders", () => {
  it.each([undefined, "generic", "google", "microsoft"])(
    "rejects retired generic providers regardless of brand %s",
    (brand) => {
      expect(parseAuthProviders([{ id: "sso", label: "Google", kind: "oidc", experimental: false, brand }])).toEqual(
        [],
      );
    },
  );

  it("brands a social provider from its id, not from the payload", () => {
    expect(
      parseAuthProviders([
        { id: "microsoft", label: "Microsoft", kind: "social", brand: "google", experimental: true },
      ]),
    ).toEqual([{ id: "microsoft", label: "Microsoft", kind: "social", brand: "microsoft", experimental: true }]);
  });

  it("preserves Google social presentation from an older server without brand metadata", () => {
    expect(parseAuthProviders([{ id: "google", label: "Google", kind: "social", experimental: true }])).toEqual([
      { id: "google", label: "Google", kind: "social", experimental: true, brand: "google" },
    ]);
  });
});

it.each([true, false, undefined, "true"])("parses the signed-out reset-email flag %s", async (passwordResetEmail) => {
  const { accountClient } = await import("@/account/accountClient");
  const { fetchAuthStatus } = await import("./fetchAuthStatus");
  const request = vi
    .spyOn(accountClient, "me")
    .mockResolvedValue(
      new Response(JSON.stringify({ authMode: "password-only", passwordResetEmail }), { status: 401 }),
    );
  try {
    expect(await fetchAuthStatus(() => false)).toMatchObject({
      kind: "login",
      passwordResetEmail: passwordResetEmail === true,
    });
  } finally {
    request.mockRestore();
  }
});
