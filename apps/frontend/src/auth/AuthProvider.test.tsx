import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MasqueradeBootstrapStatus } from "./masqueradeApi";
import { AUTH_INVALIDATION_STORAGE_KEY } from "./signOut";

const authBootstrapMocks = vi.hoisted(() => ({
  masqueradeStatus: vi.fn<() => Promise<MasqueradeBootstrapStatus>>(async () => ({ active: false })),
}));
vi.mock("./masqueradeApi", () => ({ masqueradeApi: { status: authBootstrapMocks.masqueradeStatus } }));

// The API base captures build settings at module load, so each test creates a fresh module graph for its configured deployment. Auth context must come from that same graph.

afterEach(() => {
  authBootstrapMocks.masqueradeStatus.mockReset().mockResolvedValue({ active: false });
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const me = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

async function freshProvider() {
  vi.resetModules();
  const { AuthProvider } = await import("./AuthProvider");
  const { useStore } = await import("@/store/useStore");
  const { attachPersistence } = await import("@/data/persist");
  const { resetStoreWithAccount } = await import("@/test/fixtures");
  // authContext must come from the same fresh module graph as AuthProvider (which imports it
  // internally): a statically-imported useAuth from before vi.resetModules() would read the
  // context object's default value, not whatever this AuthProvider instance provides.
  const { useAuth } = await import("./authContext");
  const { requestReauth, isReauthPending } = await import("./reauthCoordinator");
  return {
    AuthProvider,
    useStore,
    useAuth,
    attachPersistence,
    resetStoreWithAccount,
    requestReauth,
    isReauthPending,
  };
}

// Pass the hook as a prop so reset module instances do not split context identity.
function Probe({ useAuth }: { useAuth: () => { canCreateAccount: boolean } }) {
  const { canCreateAccount } = useAuth();
  return <div>{`canCreateAccount:${canCreateAccount}`}</div>;
}

// Exercise fire-and-forget refresh because callers rely on its never-reject contract.
function RefreshProbe({
  useAuth,
}: {
  useAuth: () => {
    canCreateAccount: boolean;
    refreshAuth: () => Promise<void>;
  };
}) {
  const { canCreateAccount, refreshAuth } = useAuth();
  return (
    <button type="button" onClick={() => void refreshAuth()}>
      refresh<span>{`canCreateAccount:${canCreateAccount}`}</span>
    </button>
  );
}

// Pass the hook as a prop so session assertions observe the same context instance.
function SessionProbe({ useAuth }: { useAuth: () => { authMode: string; user: { id: string } | null } }) {
  const { authMode, user } = useAuth();
  return <div>{`authMode:${authMode} user:${user?.id ?? "none"}`}</div>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("AuthProvider — demo mode (VITE_CAPACITYLENS_DEMO=1)", () => {
  // Full coverage instruments the cold application graph on this first import; DOM waits retain their normal bounds.
  it("renders children and performs no fetch at all", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_DEMO", "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const onTenantAccessReady = vi.fn();
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider onTenantAccessReady={onTenantAccessReady}>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(screen.getByText("app-content")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(onTenantAccessReady).toHaveBeenCalledTimes(1));
  }, 10_000);
});

function registerServerModeTest01() {
  it("signals tenant-data access only after a successful auth check", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    const auth = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => auth.promise),
    );
    const onTenantAccessReady = vi.fn();
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider onTenantAccessReady={onTenantAccessReady}>
        <div>app-content</div>
      </AuthProvider>,
    );

    expect(onTenantAccessReady).not.toHaveBeenCalled();
    expect(screen.queryByText("app-content")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Checking your session…");

    await act(async () => {
      auth.resolve(
        me(200, {
          authMode: "password-only",
          user: {
            id: "authenticated-user",
            name: "Authenticated user",
            email: "authenticated@example.test",
          },
        }),
      );
    });

    expect(await screen.findByText("app-content")).toBeInTheDocument();
    await waitFor(() => expect(onTenantAccessReady).toHaveBeenCalledWith("live"));
  });
}

function registerServerModeTest02() {
  it("hides tenant data immediately when a sibling tab signs out, then rechecks the session", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        me(200, {
          authMode: "password-only",
          user: { id: "u1", email: "a@b.test" },
        }),
      )
      .mockResolvedValue(me(401, { authMode: "password-only", providers: [] }));
    vi.stubGlobal("fetch", fetchSpy);
    const { AuthProvider, useStore } = await freshProvider();
    render(
      <AuthProvider>
        <div>tenant-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByText("tenant-content")).toBeInTheDocument();
    useStore.setState({ activeAccountId: "a-studio" });

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: AUTH_INVALIDATION_STORAGE_KEY,
          newValue: crypto.randomUUID(),
        }),
      );
    });

    expect(useStore.getState().activeAccountId).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Checking your session…");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
}

function registerServerModeTest03() {
  it("does not signal tenant-data access for a signed-out boot", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => me(401, { authMode: "password-only", providers: [] })),
    );
    const onTenantAccessReady = vi.fn();
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider onTenantAccessReady={onTenantAccessReady}>
        <div>app-content</div>
      </AuthProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(onTenantAccessReady).not.toHaveBeenCalled();
    expect(screen.queryByText("app-content")).not.toBeInTheDocument();
  });
}

function registerServerModeTest05() {
  it("a TRULY empty env (no demo flag, no API origin) is server mode: same-origin /api/auth/me, NOT a pass-through", async () => {
    // Guards the production same-origin deploy: an empty env must drive the credentialed auth check,
    // never the demo pass-through (which would silently bypass auth). API_BASE='' → relative /api/auth/me.
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return me(200, { authMode: "off", user: { id: "demo", name: "Demo" } });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByText("app-content")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls.at(0);
    expect(call).toBeDefined();
    if (!call) throw new Error("Expected the auth status request");
    const [request, init] = call;
    expect(request).toBe("/api/auth/me");
    expect(init?.credentials).toBe("include");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
}

function registerServerModeTest06() {
  it("authMode 'off' renders children after one credentialed /api/auth/me check", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return me(200, { authMode: "off", user: { id: "demo", name: "Demo" } });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByText("app-content")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls.at(0);
    expect(call).toBeDefined();
    if (!call) throw new Error("Expected the auth status request");
    const [request, init] = call;
    expect(request).toBe("http://api.test/api/auth/me");
    expect(init?.credentials).toBe("include");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("bootstraps an active masquerade from its validated real principal without calling auth/me", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    authBootstrapMocks.masqueradeStatus.mockResolvedValue({
      active: true,
      accountId: "a-studio",
      targetUserId: "target-user",
      targetName: "Selina Kyle",
      effectiveRole: "viewer",
      startedAt: "2026-09-01T10:00:00.000Z",
      token: "session-token",
      principal: { id: "real-principal", name: "Bruce Wayne", email: "bruce@example.test" },
      authMode: "password-only",
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { AuthProvider, useAuth, useStore, resetStoreWithAccount } = await freshProvider();
    await resetStoreWithAccount("a-studio");

    render(
      <AuthProvider>
        <SessionProbe useAuth={useAuth} />
      </AuthProvider>,
    );

    expect(await screen.findByText("authMode:password-only user:real-principal")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useStore.getState().activeAccountId).toBe("a-studio");
    expect(useStore.getState().masquerade.kind).toBe("active");
  });
}

function registerServerModeTest07() {
  it("surfaces and clears a Google step-up failure for an authenticated session", async () => {
    window.history.replaceState(
      {},
      "",
      "/team?tab=access&externalSignInError=1&error=access_denied&error_description=provider-secret",
    );
    try {
      vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          me(200, {
            authMode: "sso-only",
            user: { id: "owner", name: "Owner", email: "owner@example.com" },
            providers: [
              {
                id: "google",
                label: "Google",
                kind: "social",
                experimental: false,
              },
            ],
          }),
        ),
      );
      const { AuthProvider, useStore } = await freshProvider();
      render(
        <AuthProvider>
          <div>authenticated-app</div>
        </AuthProvider>,
      );

      expect(await screen.findByText("authenticated-app")).toBeInTheDocument();
      await waitFor(() =>
        expect(useStore.getState().notice).toMatchObject({
          message: "Single sign-on was not completed. Try again or contact your administrator.",
          tone: "error",
        }),
      );
      expect(window.location.href).toBe("http://localhost:3000/team?tab=access");
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });
}

function registerServerModeTest09() {
  it("a 401 replaces the app with the login screen (password form)", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => me(401, { authMode: "password-only", providers: [] })),
    );
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByText("app-content")).not.toBeInTheDocument();

    expect(screen.queryByText(/sign-in configuration could not be loaded/i)).not.toBeInTheDocument();
  });
}

function registerServerModeTest10() {
  it("a 401 with authMode 'sso' and a valid providers array shows the SSO sign-in form", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        me(401, {
          authMode: "sso-only",
          providers: [
            {
              id: "google",
              label: "Google",
              kind: "social",
              experimental: true,
            },
          ],
        }),
      ),
    );
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.queryByText("app-content")).not.toBeInTheDocument();

    expect(screen.queryByText(/sign-in configuration could not be loaded/i)).not.toBeInTheDocument();
  });
}

function registerServerModeTest11() {
  it("rejects duplicate provider identities instead of rendering order-dependent sign-in choices", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        me(401, {
          authMode: "sso-only",
          providers: [
            {
              id: "google",
              label: "Google",
              kind: "social",
              experimental: false,
            },
            {
              id: "google",
              label: "Other label",
              kind: "social",
              experimental: false,
            },
          ],
        }),
      ),
    );
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign in with|continue with/i })).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("duplicate provider identities"));
  });
}

function registerServerModeTest12() {
  it("drops an unsupported named social provider with a diagnostic breadcrumb", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        me(401, {
          authMode: "sso-only",
          providers: [
            {
              id: "mastodon",
              label: "Mastodon",
              kind: "social",
              experimental: true,
            },
            {
              id: "google",
              label: "Google",
              kind: "social",
              experimental: false,
            },
          ],
        }),
      ),
    );
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );

    expect(await screen.findByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Mastodon" })).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith("AuthProvider: dropped an unsupported or malformed /api/auth/me provider", {
      id: "mastodon",
      kind: "social",
    });
  });
}

function registerServerModeTest13() {
  it("DEFECT A — a 401 whose body OMITS the providers array still lands on the password sign-in wall (version-skew)", async () => {
    // An older/version-skewed server that predates the providers array must not strand the signed-out
    // user on a terminal 'invalid configuration' screen. A 401 always offers a way in.
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => me(401, { authMode: "password-only" })),
    );
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByText("The authentication service returned an invalid configuration.")).not.toBeInTheDocument();
    // Merely omitting `providers` is old-server compatibility, not a malformed body, the explicit
    // authMode is still a trustworthy signal, so no degraded notice.
    expect(screen.queryByText(/sign-in configuration could not be loaded/i)).not.toBeInTheDocument();
  });
}

function registerServerModeTest14() {
  it("DEFECT A — a 401 with an empty / HTML / non-JSON body falls back to the password sign-in wall (proxy)", async () => {
    // A proxy returning a plain-HTML 401 (or an empty body) must land on a usable sign-in form, not a
    // dead-end error screen with no way to authenticate.
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>401</html>", { status: 401 })),
    );
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    // The body couldn't be trusted at all. This fallback is a guess, not a confirmed password-mode
    // signal, so the login wall must hint that an SSO-only instance could be hiding behind it.
    expect(screen.getByText(/sign-in configuration could not be loaded/i)).toBeInTheDocument();
  });
}

function registerServerModeTest15() {
  it("DEFECT A — a 401 with a junk authMode value falls back to the password sign-in wall WITH the degraded notice", async () => {
    // Distinct from an omitted authMode (old-server compat, no notice): here the field is present
    // but neither 'password' nor 'sso', a genuinely untrustworthy body, not a version-skew case.
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => me(401, { authMode: "bogus", providers: [] })),
    );
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText(/sign-in configuration could not be loaded/i)).toBeInTheDocument();
  });
}

function registerServerModeTest16() {
  it("DEFECT A — a NON-401 failure is unchanged: it still renders the retryable auth error boundary", async () => {
    // The lenient 401 handling is scoped to 401 only. A genuinely unexpected status stays fail-closed.
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => me(500, { error: "boom" })),
    );
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(
      await screen.findByRole("heading", {
        name: "Unable to verify your session",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("app-content")).not.toBeInTheDocument();
  });
}

function registerServerModeTest17() {
  it("surfaces the authentication service's temporary-unavailability message", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => me(503, { error: "Sign-in is temporarily unavailable." })),
    );
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByText("Sign-in is temporarily unavailable.")).toBeInTheDocument();
  });
}

function registerServerModeTest18() {
  it("password invite routes render before sign-in so the token can onboard a new identity", async () => {
    window.history.pushState({}, "", "/invite/invite-token");
    try {
      vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => me(401, { authMode: "password-only", providers: [] })),
      );
      const { AuthProvider } = await freshProvider();
      render(
        <AuthProvider>
          <div>invite-page</div>
        </AuthProvider>,
      );
      expect(await screen.findByText("invite-page")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
    } finally {
      window.history.pushState({}, "", "/");
    }
  });
}

function registerServerModeTest19() {
  it("SSO invite routes render before sign-in so the provider callback preserves the token", async () => {
    window.history.pushState({}, "", "/invite/invite-token");
    try {
      vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          me(401, {
            authMode: "sso-only",
            providers: [
              {
                id: "google",
                label: "Google",
                kind: "social",
                experimental: false,
              },
            ],
          }),
        ),
      );
      const { AuthProvider } = await freshProvider();
      render(
        <AuthProvider>
          <div>invite-page</div>
        </AuthProvider>,
      );
      expect(await screen.findByText("invite-page")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
    } finally {
      window.history.pushState({}, "", "/");
    }
  });
}

function registerServerModeTest20() {
  it("a 401 with needsSetup:true shows the first-run owner-setup form instead of sign-in", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => me(401, { authMode: "password-only", needsSetup: true, providers: [] })),
    );
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Setup the account Owner" })).toBeInTheDocument();
    expect(screen.getByLabelText("name")).toBeInTheDocument();
    expect(screen.queryByText("app-content")).not.toBeInTheDocument();
  });
}

function registerServerModeTest21() {
  it("fail-closed: junk/non-boolean needsSetup on the 401 body shows the ORDINARY sign-in form", async () => {
    // A proxy page or an off-spec server must never conjure a create-account form on a populated
    // instance: only a literal `true` counts.
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => me(401, { authMode: "password-only", needsSetup: "yes", providers: [] })),
    );
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });
}

function registerServerModeTest22() {
  it("an unreachable auth server renders a retryable auth error boundary", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))),
    );
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(
      await screen.findByRole("heading", {
        name: "Unable to verify your session",
      }),
    ).toBeInTheDocument();
  });
}

function registerServerModeTest24() {
  it("keeps an auth timeout behind the error boundary even when browser storage has identity data", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    localStorage.setItem("capacitylens/offlineRead", "on");
    localStorage.setItem("capacitylens/authSnapshot", JSON.stringify({ user: { id: "stored-user" } }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("signal timed out", "TimeoutError")));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { AuthProvider } = await freshProvider();
    const onTenantAccessReady = vi.fn();

    render(
      <AuthProvider onTenantAccessReady={onTenantAccessReady}>
        <div>app-content</div>
      </AuthProvider>,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Unable to verify your session",
      }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Unable to verify your session · CapacityLens");
    expect(screen.getByRole("alert")).toHaveTextContent("The authentication service could not be reached.");
    expect(screen.getByText("The authentication service could not be reached.")).toBeInTheDocument();
    expect(screen.queryByText(/stored-user/)).not.toBeInTheDocument();
    expect(onTenantAccessReady).not.toHaveBeenCalled();
  });
}

function registerServerModeTest25() {
  it.each([
    ["no user", null],
    ["no email", { id: "u1" }],
    ["an empty email", { id: "u1", email: "   " }],
  ])("fails closed when an auth-on 200 response has %s", async (_case, user) => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => me(200, { authMode: "password-only", user })),
    );
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Unable to verify your session" })).toBeInTheDocument();
    expect(screen.queryByText("app-content")).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("auth-on without a valid user"));
  });
}

function registerServerModeTest26() {
  it("treats malformed JSON from a reachable auth service as invalid, not offline", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { status: 200 })),
    );
    const { AuthProvider } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(
      await screen.findByRole("heading", {
        name: "Unable to verify your session",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("The authentication service returned an invalid response.")).toBeInTheDocument();
  });
}

function registerServerModeTest27() {
  it("re-checks on persistError and swaps to the login screen when the session is gone", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        me(200, {
          authMode: "password-only",
          user: { id: "u1", email: "a@b.test" },
        }),
      )
      .mockResolvedValue(me(401, { authMode: "password-only", providers: [] }));
    vi.stubGlobal("fetch", fetchSpy);
    const { AuthProvider, useStore } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByText("app-content")).toBeInTheDocument();

    act(() => useStore.getState().setPersistError(true));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
}

function registerServerModeTest28() {
  it("cancels a pending step-up when a session re-check removes its React host", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        me(200, {
          authMode: "password-only",
          user: { id: "u1", email: "a@b.test" },
        }),
      )
      .mockResolvedValue(me(401, { authMode: "password-only", providers: [] }));
    vi.stubGlobal("fetch", fetchSpy);
    const { AuthProvider, useStore, requestReauth, isReauthPending } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByText("app-content")).toBeInTheDocument();

    const outcome = requestReauth();
    expect(isReauthPending()).toBe(true);
    act(() => useStore.getState().setPersistError(true));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();

    const settled = await Promise.race([
      outcome,
      new Promise<"unsettled">((resolve) => setTimeout(() => resolve("unsettled"), 100)),
    ]);
    expect(settled).toEqual({ kind: "cancelled" });
    expect(isReauthPending()).toBe(false);
  });
}

function registerServerModeTest29() {
  it("warns on the login screen when a mid-session 401 strands unsaved writes", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        me(200, {
          authMode: "password-only",
          user: { id: "u1", email: "a@b.test" },
        }),
      )
      .mockResolvedValue(me(401, { authMode: "password-only", providers: [] }));
    vi.stubGlobal("fetch", fetchSpy);
    const { AuthProvider, useStore, attachPersistence, resetStoreWithAccount } = await freshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByText("app-content")).toBeInTheDocument();

    await resetStoreWithAccount();
    const detach = attachPersistence({
      store: useStore,
      adapter: {
        loadAll: async () => useStore.getState().data,
        saveAll: vi.fn().mockResolvedValue(undefined),
      },
      debounceMs: 60_000,
      serverMode: true,
    });
    useStore.getState().addClient({ name: "Not yet saved", color: "#222222" });

    act(() => useStore.getState().setPersistError(true));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Some changes could not be saved before your session expired. They will not be restored after you sign in again.",
    );
    expect(screen.queryByText("app-content")).not.toBeInTheDocument();
    detach();
  });
}

function registerServerModeTest30() {
  it("persistError re-check that CANNOT resolve /me keeps the live authenticated snapshot (warns, no flip to auth-off)", async () => {
    // An unresolved auth re-check must preserve the current session snapshot so an outage cannot remove sign-out controls or change membership affordances.
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        me(200, {
          authMode: "password-only",
          user: { id: "u1", email: "a@b.test" },
        }),
      )
      .mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchSpy);
    const { AuthProvider, useStore, useAuth } = await freshProvider();
    render(
      <AuthProvider>
        <SessionProbe useAuth={useAuth} />
      </AuthProvider>,
    );
    expect(await screen.findByText("authMode:password-only user:u1")).toBeInTheDocument();
    act(() => useStore.getState().setPersistError(true));
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("refresh failed; keeping the previous auth snapshot")),
    );

    expect(screen.getByText("authMode:password-only user:u1")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
}

function registerServerModeTest31() {
  it("a STALE refreshAuth resolving after a newer 401 does not overwrite the login status", async () => {
    // A newer confirmed sign-out must win over an earlier authenticated response, or stale credentials would reopen the protected app.
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    const slow = deferred<Response>();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        me(200, {
          authMode: "password-only",
          user: { id: "u1", email: "a@b.test" },
        }),
      )
      .mockImplementationOnce(() => slow.promise)
      .mockResolvedValue(me(401, { authMode: "password-only", providers: [] }));
    vi.stubGlobal("fetch", fetchSpy);
    const { AuthProvider, useStore, useAuth } = await freshProvider();
    render(
      <AuthProvider>
        <RefreshProbe useAuth={useAuth} />
      </AuthProvider>,
    );
    expect(await screen.findByRole("button", { name: /refresh/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /refresh/ }));
    act(() => useStore.getState().setPersistError(true));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();

    await act(async () => {
      slow.resolve(
        me(200, {
          authMode: "password-only",
          user: { id: "u1", email: "a@b.test" },
        }),
      );
      await slow.promise;
    });

    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refresh/ })).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
}
describe("AuthProvider — server mode", () => {
  registerServerModeTest01();
  registerServerModeTest02();
  registerServerModeTest03();
  registerServerModeTest05();
  registerServerModeTest06();
  registerServerModeTest07();
  registerServerModeTest09();
  registerServerModeTest10();
  registerServerModeTest11();
  registerServerModeTest12();
  registerServerModeTest13();
  registerServerModeTest14();
  registerServerModeTest15();
  registerServerModeTest16();
  registerServerModeTest17();
  registerServerModeTest18();
  registerServerModeTest19();
  registerServerModeTest20();
  registerServerModeTest21();
  registerServerModeTest22();
  registerServerModeTest24();
  registerServerModeTest25();
  registerServerModeTest26();
  registerServerModeTest27();
  registerServerModeTest28();
  registerServerModeTest29();
  registerServerModeTest30();
  registerServerModeTest31();
});

// The server supplies the first-company setup flag; it remains the authorization boundary.
function registerAccountPolicyTest01() {
  it("parses canCreateAccount:false from a mocked /api/auth/me", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        me(200, {
          authMode: "off",
          user: null,
          canCreateAccount: false,
        }),
      ),
    );
    const { AuthProvider, useAuth } = await freshProvider();
    render(
      <AuthProvider>
        <Probe useAuth={useAuth} />
      </AuthProvider>,
    );
    expect(await screen.findByText("canCreateAccount:false")).toBeInTheDocument();
  });
}

function registerAccountPolicyTest02() {
  it("parses canCreateAccount:true from a mocked /api/auth/me", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        me(200, {
          authMode: "off",
          user: null,
          canCreateAccount: true,
        }),
      ),
    );
    const { AuthProvider, useAuth } = await freshProvider();
    render(
      <AuthProvider>
        <Probe useAuth={useAuth} />
      </AuthProvider>,
    );
    expect(await screen.findByText("canCreateAccount:true")).toBeInTheDocument();
  });
}

function registerAccountPolicyTest03() {
  it("defaults first-company setup to true when an older server omits it from an otherwise-valid body", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => me(200, { authMode: "off", user: null })),
    );
    const { AuthProvider, useAuth } = await freshProvider();
    render(
      <AuthProvider>
        <Probe useAuth={useAuth} />
      </AuthProvider>,
    );
    expect(await screen.findByText("canCreateAccount:true")).toBeInTheDocument();
  });
}

function registerAccountPolicyTest04() {
  it("fails closed on a boot-time auth fetch failure", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))),
    );
    const { AuthProvider, useAuth } = await freshProvider();
    render(
      <AuthProvider>
        <Probe useAuth={useAuth} />
      </AuthProvider>,
    );
    expect(
      await screen.findByRole("heading", {
        name: "Unable to verify your session",
      }),
    ).toBeInTheDocument();
  });
}

function registerAccountPolicyTest05() {
  it("fails closed on a 200 response with an off-spec authMode", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => me(200, { authMode: "bogus", privateValue: "SENTINEL_AUTH_PAYLOAD" })),
    );
    const { AuthProvider, useAuth } = await freshProvider();
    render(
      <AuthProvider>
        <Probe useAuth={useAuth} />
      </AuthProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Unable to verify your session" })).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unexpected authMode"));
  });
}

function registerAccountPolicyTest06() {
  it("refreshAuth re-asks /api/auth/me and a flipped canCreateAccount reaches consumers", async () => {
    // The server recomputes canCreateAccount per request (account count + membership roles), so a
    // consumer that just changed that state (org create/delete) calls refreshAuth, the boot-time
    // snapshot must not be the last word.
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        me(200, {
          authMode: "off",
          user: null,
          canCreateAccount: false,
        }),
      )
      .mockResolvedValue(
        me(200, {
          authMode: "off",
          user: null,
          canCreateAccount: true,
        }),
      );
    vi.stubGlobal("fetch", fetchSpy);
    const { AuthProvider, useAuth } = await freshProvider();
    render(
      <AuthProvider>
        <RefreshProbe useAuth={useAuth} />
      </AuthProvider>,
    );
    expect(await screen.findByText("canCreateAccount:false")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /refresh/ }));
    expect(await screen.findByText("canCreateAccount:true")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
}

function registerAccountPolicyTest07() {
  it("a FAILED refresh keeps the previous (stale) snapshot with a warn breadcrumb — no crash, no reset", async () => {
    // Fail-open posture (see fetchAuthStatus): an unresolved refresh must not flip a live session
    // to authMode 'off' / canCreateAccount true, stale beats wrong, and the server 403 remains
    // the real enforcer. The handler logs and surfaces its failure.
    vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        me(200, {
          authMode: "off",
          user: null,
          canCreateAccount: false,
        }),
      )
      .mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchSpy);
    const { AuthProvider, useAuth } = await freshProvider();
    render(
      <AuthProvider>
        <RefreshProbe useAuth={useAuth} />
      </AuthProvider>,
    );
    expect(await screen.findByText("canCreateAccount:false")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /refresh/ }));
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("refresh failed; keeping the previous auth snapshot")),
    );

    expect(screen.getByText("canCreateAccount:false")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
}

function registerAccountPolicyTest08() {
  it("defaults to true in the demo build (no fetch at all)", async () => {
    vi.stubEnv("VITE_CAPACITYLENS_DEMO", "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { AuthProvider, useAuth } = await freshProvider();
    render(
      <AuthProvider>
        <Probe useAuth={useAuth} />
      </AuthProvider>,
    );
    expect(await screen.findByText("canCreateAccount:true")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
}
describe("AuthProvider — first-company setup policy", () => {
  registerAccountPolicyTest01();
  registerAccountPolicyTest02();
  registerAccountPolicyTest03();
  registerAccountPolicyTest04();
  registerAccountPolicyTest05();
  registerAccountPolicyTest06();
  registerAccountPolicyTest07();
  registerAccountPolicyTest08();
});
