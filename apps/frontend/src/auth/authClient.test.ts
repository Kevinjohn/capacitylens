import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/apiConfig", () => ({ API_BASE: "https://api.example.test" }));

import { authClient } from "./authClient";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("product auth client", () => {
  it("posts password sign-in with session credentials for the backend's same-site CSRF boundary", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    let sent: Request | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      sent = new Request(input, init).clone();
      return Response.json({ user: { id: "u1", name: "Bruce Wayne", email: "bruce@example.test", image: null } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await authClient.signIn.email({ email: "bruce@example.test", password: "correct horse" });

    expect(fetchMock).toHaveBeenCalledOnce();
    if (!sent) throw new Error("Expected captured request");
    const request = sent;
    expect(request.url).toBe("https://api.example.test/api/auth/sign-in");
    expect(request.method).toBe("POST");
    expect(request.credentials).toBe("include");
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(await request.json()).toEqual({ email: "bruce@example.test", password: "correct horse" });
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.has("x-xsrf-token")).toBe(false);
    expect(result).toEqual({
      data: { user: { id: "u1", name: "Bruce Wayne", email: "bruce@example.test", image: null } },
      error: null,
    });
  });

  it("preserves native transport failures and unreadable-success fallback", async () => {
    for (const failure of [new TypeError("Network unavailable"), new DOMException("Aborted", "AbortError")]) {
      const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(failure);
      vi.stubGlobal("fetch", fetchMock);
      await expect(authClient.signIn.email({ email: "clark@wayne.example", password: "secret" })).rejects.toBe(failure);
      expect(fetchMock).toHaveBeenCalledOnce();
    }
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("invalid json", { headers: { "content-type": "application/json" } })),
    );
    await expect(authClient.signIn.email({ email: "clark@wayne.example", password: "secret" })).resolves.toEqual({
      data: null,
      error: null,
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
    await authClient.changePassword({ currentPassword: "current-password", newPassword: "new-password" });
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
      { currentPassword: "current-password", newPassword: "new-password" },
      {},
    ]);
  });
});
