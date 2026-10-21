import { describe, expect, it, vi } from "vitest";
import { parseAuthProviders } from "./authStatus";
import { masqueradeApi } from "./masqueradeApi";

describe("parseAuthProviders", () => {
  it.each([undefined, "generic", "google", "microsoft"])(
    "rejects retired generic providers regardless of brand %s",
    (brand) => {
      expect(parseAuthProviders([{ id: "sso", label: "Google", kind: "oidc", experimental: false, brand }])).toEqual(
        [],
      );
    },
  );

  it("drops deferred and retired providers even if the server advertises them", () => {
    expect(
      parseAuthProviders([
        { id: "microsoft", label: "Microsoft", kind: "social", brand: "google", experimental: true },
        { id: "github", label: "GitHub", kind: "social", experimental: true },
      ]),
    ).toEqual([]);
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
  const status = vi.spyOn(masqueradeApi, "status").mockResolvedValue({ active: false });
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
    status.mockRestore();
    request.mockRestore();
  }
});

describe("fetchAuthStatus when masquerade status is unreachable", () => {
  it("does not treat a successful /me response as proof that the projection is inactive", async () => {
    const { accountClient } = await import("@/account/accountClient");
    const { fetchAuthStatus } = await import("./fetchAuthStatus");
    const status = vi.spyOn(masqueradeApi, "status").mockRejectedValue(new TypeError("offline"));
    const request = vi.spyOn(accountClient, "me").mockResolvedValue(
      new Response(
        JSON.stringify({
          authMode: "password-only",
          canCreateAccount: false,
          providers: [],
          user: { id: "real-user", email: "real@example.test", name: "Real User" },
        }),
        { status: 200 },
      ),
    );
    try {
      expect(await fetchAuthStatus(() => false)).toMatchObject({ kind: "error" });
    } finally {
      status.mockRestore();
      request.mockRestore();
    }
  });

  it("uses a live 401 to offer sign-in while masquerade status is unreachable", async () => {
    const { accountClient } = await import("@/account/accountClient");
    const { fetchAuthStatus } = await import("./fetchAuthStatus");
    const status = vi.spyOn(masqueradeApi, "status").mockRejectedValue(new TypeError("offline"));
    const request = vi
      .spyOn(accountClient, "me")
      .mockResolvedValue(new Response(JSON.stringify({ authMode: "password-only" }), { status: 401 }));
    try {
      expect(await fetchAuthStatus(() => false)).toMatchObject({ kind: "login" });
    } finally {
      status.mockRestore();
      request.mockRestore();
    }
  });

  it("does not query /me after a non-transport status failure", async () => {
    const { accountClient } = await import("@/account/accountClient");
    const { fetchAuthStatus } = await import("./fetchAuthStatus");
    const status = vi.spyOn(masqueradeApi, "status").mockRejectedValue(new Error("status rejected"));
    const request = vi.spyOn(accountClient, "me");
    try {
      expect(await fetchAuthStatus(() => false)).toMatchObject({ kind: "error" });
      expect(request).not.toHaveBeenCalled();
    } finally {
      status.mockRestore();
      request.mockRestore();
    }
  });
});
