import { describe, expect, it, vi } from "vitest";
import { masqueradeApi } from "./masqueradeApi";

it.each([true, false, undefined, "true"])("parses the signed-out reset-email flag %s", async (passwordResetEmail) => {
  const { accountClient } = await import("@/account/accountClient");
  const { fetchAuthStatus } = await import("./fetchAuthStatus");
  const status = vi.spyOn(masqueradeApi, "status").mockResolvedValue({ active: false, contextToken: "idle-context" });
  const request = vi
    .spyOn(accountClient, "me")
    .mockResolvedValue(
      new Response(JSON.stringify({ authMode: "password-only", passwordResetEmail }), { status: 401 }),
    );
  try {
    expect(await fetchAuthStatus(() => true)).toMatchObject({
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

describe("fetchAuthStatus masquerade reconciliation", () => {
  it("adopts the idle request proof before querying the authenticated setup boundary", async () => {
    const { accountClient } = await import("@/account/accountClient");
    const { fetchAuthStatus } = await import("./fetchAuthStatus");
    const { getMasqueradeContextToken, setMasqueradeContextToken } = await import("./masqueradeContext");
    const status = vi.spyOn(masqueradeApi, "status").mockResolvedValue({
      active: false,
      contextToken: "idle-context",
    });
    const request = vi.spyOn(accountClient, "me").mockImplementation(async () => {
      expect(getMasqueradeContextToken()).toBe("idle-context");
      return new Response(JSON.stringify({ authMode: "password-only" }), { status: 401 });
    });
    try {
      await expect(fetchAuthStatus(() => true)).resolves.toMatchObject({ kind: "login" });
      expect(status).toHaveBeenCalledOnce();
      expect(request).toHaveBeenCalledOnce();
    } finally {
      status.mockRestore();
      request.mockRestore();
      setMasqueradeContextToken(null);
    }
  });

  it("routes an inactive auth status through recovery for a locally active projection", async () => {
    const { accountClient } = await import("@/account/accountClient");
    const { useStore } = await import("@/store/useStore");
    const { fetchAuthStatus } = await import("./fetchAuthStatus");
    const { masqueradeController } = await import("./masqueradeController");
    const { getMasqueradeContextToken, setMasqueradeContextToken } = await import("./masqueradeContext");
    const status = vi.spyOn(masqueradeApi, "status").mockResolvedValue({
      active: false,
      contextToken: "new-idle-context",
    });
    const request = vi
      .spyOn(accountClient, "me")
      .mockResolvedValue(new Response(JSON.stringify({ authMode: "password-only" }), { status: 401 }));
    const restore = vi.spyOn(masqueradeController, "restoreServerEndedProjection").mockImplementation(() => {});
    useStore.setState({
      activeAccountId: "a-studio",
      masquerade: {
        kind: "active",
        generation: 8,
        state: {
          accountId: "a-studio",
          targetUserId: "u-viewer",
          targetName: "Selina Kyle",
          effectiveRole: "viewer",
          startedAt: "2026-09-01T10:00:00.000Z",
          expiresAt: "2026-09-01T10:15:00.000Z",
          token: "old-mode-context",
        },
      },
    });
    try {
      await expect(fetchAuthStatus(() => true)).resolves.toMatchObject({ kind: "login" });
      expect(restore).toHaveBeenCalledOnce();
      expect(getMasqueradeContextToken()).toBe("new-idle-context");
    } finally {
      status.mockRestore();
      request.mockRestore();
      restore.mockRestore();
      masqueradeController.invalidate();
      setMasqueradeContextToken(null);
    }
  });

  it("ignores an active status read that resolves after local identity invalidation", async () => {
    const { fetchAuthStatus } = await import("./fetchAuthStatus");
    const { masqueradeController } = await import("./masqueradeController");
    const { useStore } = await import("@/store/useStore");
    const { getMasqueradeContextToken } = await import("./masqueradeContext");
    let resolveStatus!: (status: Awaited<ReturnType<typeof masqueradeApi.status>>) => void;
    const status = vi.spyOn(masqueradeApi, "status").mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    const adopt = vi.spyOn(masqueradeController, "adoptStatus");
    const activeStatus = {
      active: true as const,
      accountId: "a-studio",
      targetUserId: "u-viewer",
      targetName: "Selina Kyle",
      effectiveRole: "viewer" as const,
      startedAt: "2026-09-01T10:00:00.000Z",
      expiresAt: "2026-09-01T10:15:00.000Z",
      token: "stale-mode-token",
      contextToken: "stale-mode-token",
      principal: { id: "real-user", email: "real@example.test" },
      authMode: "password-only" as const,
    };
    try {
      const pending = fetchAuthStatus(() => true);
      await vi.waitFor(() => expect(status).toHaveBeenCalledOnce());
      masqueradeController.invalidate();
      resolveStatus(activeStatus);

      await expect(pending).resolves.toBeNull();
      expect(adopt).not.toHaveBeenCalled();
      expect(useStore.getState().masquerade).toEqual({ kind: "inactive" });
      expect(getMasqueradeContextToken()).toBeNull();
    } finally {
      status.mockRestore();
      adopt.mockRestore();
      masqueradeController.invalidate();
    }
  });
});
