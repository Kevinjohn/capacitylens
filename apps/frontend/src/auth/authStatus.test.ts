import { describe, expect, it, vi } from "vitest";
import { masqueradeApi } from "./masqueradeApi";

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
