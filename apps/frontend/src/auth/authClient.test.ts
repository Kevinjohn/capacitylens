import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/apiConfig", () => ({ API_BASE: "https://api.example.test" }));

import { authClient } from "./authClient";

afterEach(() => vi.unstubAllGlobals());

describe("product auth client", () => {
  it("posts password sign-in with session credentials for the backend's same-site CSRF boundary", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ user: { id: "u1", name: "Bruce Wayne", email: "bruce@example.test", image: null } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await authClient.signIn.email({ email: "bruce@example.test", password: "correct horse" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("Expected one sign-in request");
    const [url, init] = call;
    expect(url).toBe("https://api.example.test/api/auth/sign-in");
    expect(init).toEqual(
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ email: "bruce@example.test", password: "correct horse" }),
      }),
    );
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(new Headers(init?.headers).has("x-xsrf-token")).toBe(false);
    expect(result).toEqual({
      data: { user: { id: "u1", name: "Bruce Wayne", email: "bruce@example.test", image: null } },
      error: null,
    });
  });

  it("sends owner setup token as a header and does not include it in the JSON body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { user: { id: "u1", name: "Bruce Wayne", email: "bruce@example.test", image: null } },
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await authClient.signUp.email({
      name: "Bruce Wayne",
      email: "bruce@example.test",
      password: "correct horse",
      fetchOptions: { headers: { "x-capacitylens-setup-token": "setup-secret" } },
    });

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("Expected one sign-up request");
    const [, init] = call;
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get("x-capacitylens-setup-token")).toBe("setup-secret");
    expect(JSON.parse(String(init?.body))).toEqual({
      email: "bruce@example.test",
      password: "correct horse",
      name: "Bruce Wayne",
    });
  });

  it("maps flat API errors without losing status or code", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ error: "Invalid email or password.", code: "INVALID_CREDENTIALS" }, { status: 401 }),
        ),
    );

    await expect(authClient.signIn.email({ email: "x@example.test", password: "wrong" })).resolves.toEqual({
      data: null,
      error: { message: "Invalid email or password.", code: "INVALID_CREDENTIALS", status: 401 },
    });
  });

  it("gives malformed error bodies a status-specific fallback", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 503 })));

    await expect(authClient.requestPasswordReset("bruce@example.test")).resolves.toEqual({
      data: null,
      error: { message: "Authentication request failed (503).", status: 503 },
    });
  });

  it("uses native recovery, password-change, and sign-out routes", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await authClient.requestPasswordReset("bruce@example.test");
    await authClient.resetPassword({ token: "single-use-token", newPassword: "new-password" });
    await authClient.changePassword({
      currentPassword: "current-password",
      newPassword: "new-password",
      revokeOtherSessions: true,
    });
    await authClient.signOut();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example.test/api/auth/request-reset",
      "https://api.example.test/api/auth/reset-password",
      "https://api.example.test/api/auth/change-password",
      "https://api.example.test/api/auth/sign-out",
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { email: "bruce@example.test" },
      { token: "single-use-token", newPassword: "new-password" },
      { currentPassword: "current-password", newPassword: "new-password", revokeOtherSessions: true },
      {},
    ]);
  });
});
