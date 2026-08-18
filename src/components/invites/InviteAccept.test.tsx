import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { InviteAccept } from "./InviteAccept";
import { AuthContext, type AuthContextValue } from "../../auth/authContext";
import { useStore } from "../../store/useStore";
import { DEFAULT_ACCOUNT_ID, resetStoreWithAccount } from "../../test/fixtures";
import { m } from "@/i18n";
import { APP_NAME } from "@capacitylens/shared/brand";
import { EXTERNAL_NAVIGATION_TIMEOUT_MS } from "./externalSignIn";

const authClientMock = vi.hoisted(() => ({
  signInEmail: vi.fn(async (): Promise<{ error: { message?: string } | null }> => ({ error: null })),
  signInOauth2: vi.fn(async () => ({ error: null })),
  signInSocial: vi.fn(async (input?: { fetchOptions?: { signal?: AbortSignal } }) => {
    void input;
    return { error: null };
  }),
}));
const handoffMock = vi.hoisted(() => ({
  replaceWithJoinedAccount: vi.fn(),
  replaceWithAccountPicker: vi.fn(),
}));
const reloadMock = vi.hoisted(() => ({ reloadPage: vi.fn() }));
const apiConfigMock = vi.hoisted(() => ({
  isServerConfigured: vi.fn(() => true),
}));

vi.mock("../../auth/authClient", () => ({
  authClient: {
    signIn: {
      email: authClientMock.signInEmail,
      oauth2: authClientMock.signInOauth2,
      social: authClientMock.signInSocial,
    },
  },
}));

vi.mock("../../data/apiConfig", () => ({
  API_BASE: "http://api.test",
  isServerConfigured: apiConfigMock.isServerConfigured,
}));

vi.mock("../../lib/joinedAccountHandoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/joinedAccountHandoff")>()),
  replaceWithJoinedAccount: handoffMock.replaceWithJoinedAccount,
  replaceWithAccountPicker: handoffMock.replaceWithAccountPicker,
}));

vi.mock("../../lib/reloadPage", () => reloadMock);

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  vi.clearAllMocks();
  apiConfigMock.isServerConfigured.mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const previewResponse = (role = "editor"): Response =>
  ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      accountName: "Wayne Enterprises",
      role,
      expiresAt: "2999-01-01T00:00:00.000Z",
    }),
  }) as Response;

const signedInAuth: AuthContextValue = {
  authMode: "password",
  user: { id: "user-1", name: "Alex", email: "alex@example.com" },
  canCreateAccount: true,
  multiAccount: true,
  refreshAuth: async () => {},
  signOut: async () => {},
};

function renderInvite(auth?: AuthContextValue, strict = false, path = "/invite/secret-token") {
  const content = (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/invite/:token" element={<InviteAccept />} />
        <Route path="/" element={<div data-testid="app-route">App</div>} />
      </Routes>
    </MemoryRouter>
  );
  const wrapped = auth ? <AuthContext.Provider value={auth}>{content}</AuthContext.Provider> : content;
  return render(strict ? <StrictMode>{wrapped}</StrictMode> : wrapped);
}

describe("InviteAccept preview and acceptance", () => {
  async function fillInviteCredentials(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Name"), "New Person");
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "invite-password-123");
  }

  it("identifies the signed-in account and offers to switch without losing the invite route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(previewResponse()));
    const signOut = vi.fn(async () => {});
    const user = userEvent.setup();

    renderInvite({ ...signedInAuth, signOut });

    expect(await screen.findByText("Signed in as alex@example.com.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use a different account" }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("turns an invitation identity mismatch into a recoverable account switch", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) return previewResponse();
      if (url.endsWith("/accept") && init?.method === "POST") {
        return Response.json(
          { code: "INVITATION_EMAIL_MISMATCH", error: "This invite is reserved for a different identity." },
          { status: 403 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const signOut = vi.fn(async () => {});
    const user = userEvent.setup();

    renderInvite({ ...signedInAuth, signOut });
    await user.click(await screen.findByRole("button", { name: "Accept invite" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("reserved for a different identity");
    await user.click(screen.getByRole("button", { name: "Use a different account" }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("explains that invites require a server in the in-memory demo without fetching", () => {
    apiConfigMock.isServerConfigured.mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderInvite();

    expect(screen.getByText(m.invite_local_mode({ app: APP_NAME }))).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restarts a cancelled preview effect under React Strict Mode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(previewResponse()));

    renderInvite(undefined, true);

    expect(await screen.findByTestId("invite-preview")).toHaveTextContent("Wayne Enterprises");
  });

  it("previews the company and asks an unauthenticated invitee to sign in without consuming the invite", async () => {
    const fetchMock = vi.fn().mockResolvedValue(previewResponse());
    vi.stubGlobal("fetch", fetchMock);

    renderInvite();

    const preview = await screen.findByTestId("invite-preview");
    expect(preview).toHaveTextContent("Wayne Enterprises");
    expect(preview).toHaveTextContent("Editor");
    expect(preview).toHaveTextContent("Invitation role");
    expect(preview).toHaveTextContent(/keeps your existing role/i);
    expect(preview).toHaveTextContent(/Can edit scheduling data/);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/invites/secret-token/preview",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("strips an external sign-in error marker and surfaces stable SSO failure copy", async () => {
    window.history.replaceState({}, "", "/invite/secret-token?externalSignInError=1&error=provider-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(previewResponse()));

    renderInvite(
      {
        ...signedInAuth,
        authMode: "sso",
        user: null,
        providers: [{ id: "sso", label: "Single sign-on", kind: "oidc", experimental: false }],
      },
      false,
      "/invite/secret-token?externalSignInError=1&error=provider-secret",
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_sso_failed());
    expect(screen.getByRole("alert")).not.toHaveTextContent("provider-secret");
    await vi.waitFor(() => expect(window.location.search).toBe(""));
  });

  it.each([
    [404, () => m.invite_err_not_found()],
    [409, () => m.invite_err_used()],
    [410, () => m.invite_err_expired()],
  ])("maps a bodyless %i preview response to its invite outcome", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));

    renderInvite();

    expect(await screen.findByRole("alert")).toHaveTextContent(message());
  });

  it("marks only the credential field that failed account validation as invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(previewResponse()));
    const user = userEvent.setup();
    renderInvite();

    await screen.findByTestId("invite-preview");
    const name = screen.getByLabelText("Name");
    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    const create = screen.getByRole("button", {
      name: "Create account and accept",
    });

    await user.click(create);
    const nameError = screen.getByText("Enter a valid name.");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute("aria-describedby", nameError.id);
    expect(email).not.toHaveAttribute("aria-invalid");
    expect(password).not.toHaveAttribute("aria-invalid");

    await user.type(name, "New Person");
    await user.click(create);
    const emailError = screen.getByText("Enter a valid email address.");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAttribute("aria-describedby", emailError.id);
    expect(name).not.toHaveAttribute("aria-invalid");
    expect(password).not.toHaveAttribute("aria-invalid");

    await user.type(email, "new@example.com");
    await user.click(create);
    const passwordError = screen.getByText("Password must be 15–128 characters.");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute("aria-describedby", passwordError.id);
    expect(name).not.toHaveAttribute("aria-invalid");
    expect(email).not.toHaveAttribute("aria-invalid");
  });

  it("rejects a signup email containing disallowed characters", async () => {
    // Regression: the inline check used to only compare UTF-16 .length against MAX_EMAIL_LENGTH
    // and never screened for disallowed characters, so an emoji/zero-width address that stayed
    // under the length cap slipped past client-side validation. isAccountEmail() rejects it.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(previewResponse()));
    const user = userEvent.setup();
    renderInvite();

    await screen.findByTestId("invite-preview");
    const name = screen.getByLabelText("Name");
    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    const create = screen.getByRole("button", {
      name: "Create account and accept",
    });

    await user.type(name, "New Person");
    fireEvent.change(email, { target: { value: "a​🙂@example.com" } });
    await user.type(password, "a-strong-enough-password");
    await user.click(create);

    const emailError = screen.getByText(m.identity_err_email());
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAttribute("aria-describedby", emailError.id);
  });

  it("starts strict OIDC from the invite URL so the callback returns to the bearer route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(previewResponse()));
    authClientMock.signInOauth2.mockImplementationOnce(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderInvite({
      ...signedInAuth,
      authMode: "sso",
      user: null,
      providers: [
        {
          id: "sso",
          label: "Single sign-on",
          kind: "oidc",
          experimental: false,
        },
      ],
    });

    await screen.findByTestId("invite-preview");
    await user.click(
      screen.getByRole("button", {
        name: m.invite_continue_provider({ provider: "Single sign-on" }),
      }),
    );
    window.dispatchEvent(new Event("pagehide"));
    expect(authClientMock.signInOauth2).toHaveBeenCalledWith({
      providerId: "sso",
      callbackURL: window.location.href,
      errorCallbackURL: "http://localhost:3000/?externalSignInError=1",
      disableRedirect: true,
      fetchOptions: { signal: expect.any(AbortSignal) },
    });
    expect(authClientMock.signInEmail).not.toHaveBeenCalled();
  });

  it("preserves the invite route for social failures and recovers when success does not navigate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(previewResponse()));
    authClientMock.signInSocial.mockImplementationOnce(() => new Promise(() => {}));
    renderInvite({
      ...signedInAuth,
      user: null,
      providers: [{ id: "google", label: "Google", kind: "social", experimental: true }],
    });

    await screen.findByTestId("invite-preview");
    vi.useFakeTimers();
    const button = screen.getByRole("button", { name: m.invite_continue_provider({ provider: "Google" }) });
    fireEvent.click(button);
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(EXTERNAL_NAVIGATION_TIMEOUT_MS);
    });
    expect(authClientMock.signInSocial).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: window.location.href,
      errorCallbackURL: "http://localhost:3000/?externalSignInError=1",
      disableRedirect: true,
      fetchOptions: { signal: expect.any(AbortSignal) },
    });
    const socialSignal = authClientMock.signInSocial.mock.calls[0]?.[0]?.fetchOptions?.signal;
    expect(socialSignal).toBeInstanceOf(AbortSignal);
    expect(socialSignal?.aborted).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent(m.login_failed());
    expect(button).toBeEnabled();
  });

  it("recovers provider controls when a redirect returns from the back-forward cache", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(previewResponse()));
    authClientMock.signInSocial.mockImplementationOnce(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderInvite({
      ...signedInAuth,
      user: null,
      providers: [{ id: "google", label: "Google", kind: "social", experimental: true }],
    });

    const button = await screen.findByRole("button", {
      name: m.invite_continue_provider({ provider: "Google" }),
    });
    await user.click(button);
    window.dispatchEvent(new Event("pagehide"));
    const pageShow = new Event("pageshow");
    Object.defineProperty(pageShow, "persisted", { value: true });
    window.dispatchEvent(pageShow);

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_failed());
    expect(button).toBeEnabled();
  });

  it.each(["2026-02-30T12:00:00.000Z", "0", "2026-07-29", "2026-07-29T01:00:00+01:00"])(
    "rejects noncanonical preview expiry %j",
    async (expiresAt) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ...previewResponse(),
          json: async () => ({ accountName: "Wayne Enterprises", role: "editor", expiresAt }),
        }),
      );
      renderInvite();
      expect(await screen.findByRole("alert")).toHaveTextContent(m.invite_err_preview_invalid());
    },
  );

  it("hands a newly-created invitee to a fresh boot for the verified joined company", async () => {
    resetStoreWithAccount();
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries([]);
    authClientMock.signInEmail.mockResolvedValueOnce({ error: null });
    const refreshAuth = vi.fn(async () => {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) return previewResponse("editor");
      if (url.endsWith("/signup") && init?.method === "POST") {
        return {
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            accountId: "joined-account",
            role: "editor",
          }),
        } as Response;
      }
      if (url.endsWith("/api/accounts")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => [{ id: "joined-account", name: "Wayne Enterprises", role: "editor" }],
        } as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderInvite({
      ...signedInAuth,
      user: null,
      refreshAuth,
    });
    await screen.findByTestId("invite-preview");
    await user.type(screen.getByLabelText("Name"), "New Person");
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "invite-password-123");
    await user.click(screen.getByRole("button", { name: "Create account and accept" }));

    await vi.waitFor(() => expect(handoffMock.replaceWithJoinedAccount).toHaveBeenCalledWith("joined-account"));
    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(useStore.getState().activeAccountId).toBe("joined-account");
    expect(useStore.getState().accountSummaries).toEqual([
      { id: "joined-account", name: "Wayne Enterprises", role: "editor" },
    ]);
  });

  it("requires an explicit accept action and reports the effective role returned by the server", async () => {
    let resolveAccept!: (response: Response) => void;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) return previewResponse("viewer");
      if (url.endsWith("/accept") && init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolveAccept = resolve;
        });
      }
      if (url.endsWith("/api/accounts")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => [{ id: "account-1", name: "Wayne Enterprises", role: "admin" }],
        } as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderInvite(signedInAuth);

    const accept = await screen.findByRole("button", { name: "Accept invite" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("invite-preview")).toHaveTextContent("Viewer");
    expect(screen.getByRole("status")).toHaveTextContent(m.invite_review_prompt());

    await user.click(accept);
    const joining = screen.getByRole("status");
    expect(joining).toHaveTextContent(m.invite_joining());
    expect(joining).toHaveFocus();
    resolveAccept(Response.json({ accountId: "account-1", role: "admin" }, { status: 200 }));

    expect(await screen.findByText("You’ve joined Wayne Enterprises as Admin.")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: m.invite_continue() })).toHaveFocus();
    expect(
      fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toHaveLength(1);
  });

  it.each([
    [true, m.invite_invalid_result_refreshed()],
    [false, m.invite_invalid_result_refresh_failed()],
  ])("reconciles an invalid successful accept result (accounts success: %s)", async (accountsOk, expected) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) return previewResponse();
      if (url.endsWith("/accept") && init?.method === "POST") return Response.json({});
      if (url.endsWith("/api/accounts")) {
        return accountsOk ? Response.json([]) : Response.json({ error: "unavailable" }, { status: 500 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderInvite(signedInAuth);
    await user.click(await screen.findByRole("button", { name: "Accept invite" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/accounts"))).toBe(true);
  });

  it.each([
    [true, m.invite_unknown_outcome_refreshed()],
    [false, m.invite_unknown_outcome_refresh_failed()],
  ])("reconciles a rejected accept request and offers Retry (accounts success: %s)", async (accountsOk, expected) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) return previewResponse();
      if (url.endsWith("/accept") && init?.method === "POST") throw new TypeError("offline");
      if (url.endsWith("/api/accounts")) {
        return accountsOk ? Response.json([]) : Response.json({ error: "unavailable" }, { status: 500 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderInvite(signedInAuth);
    await user.click(await screen.findByRole("button", { name: "Accept invite" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    expect(screen.getByRole("button", { name: m.invite_retry_accept() })).toBeEnabled();
  });

  it("keeps a confirmed join when the follow-up company activation refresh rejects", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(useStore.getState(), "setAccountSummaries").mockImplementationOnce(() => {
      throw new Error("directory publication failed");
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) return previewResponse("editor");
      if (url.endsWith("/accept") && init?.method === "POST") {
        return Response.json({ accountId: "joined-account", role: "editor" });
      }
      if (url.endsWith("/api/accounts")) {
        return Response.json([{ id: "joined-account", name: "Wayne Enterprises", role: "editor" }]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderInvite(signedInAuth);
    await user.click(await screen.findByRole("button", { name: "Accept invite" }));

    expect(await screen.findByText("You’ve joined Wayne Enterprises as Editor.")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: m.invite_continue() })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: m.invite_retry_accept() })).not.toBeInTheDocument();
  });

  it("explains an accept-time 401 when returning to the sign-in form", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) return previewResponse("editor");
      if (url.endsWith("/accept") && init?.method === "POST") {
        return new Response(null, { status: 401 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderInvite(signedInAuth);
    await user.click(await screen.findByRole("button", { name: "Accept invite" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.invite_err_signin());
    expect(screen.getByRole("button", { name: m.invite_sign_in_accept() })).toBeInTheDocument();
  });

  it("does not switch companies after the invite route is left during activation", async () => {
    resetStoreWithAccount();
    let resolveAccounts!: (response: Response) => void;
    const pendingAccounts = new Promise<Response>((resolve) => {
      resolveAccounts = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) return previewResponse("editor");
      if (url.endsWith("/accept") && init?.method === "POST") {
        return Response.json({ accountId: "joined-account", role: "editor" });
      }
      if (url.endsWith("/api/accounts")) return pendingAccounts;
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    const view = renderInvite(signedInAuth);
    await user.click(await screen.findByRole("button", { name: "Accept invite" }));
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/accounts"))).toBe(true);
    });

    view.unmount();
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
    resolveAccounts(Response.json([{ id: "joined-account", name: "Wayne Enterprises", role: "editor" }]));

    await vi.waitFor(() => {
      expect(useStore.getState().accountSummaries).toEqual([
        { id: "joined-account", name: "Wayne Enterprises", role: "editor" },
      ]);
    });
    expect(useStore.getState().activeAccountId).toBe(DEFAULT_ACCOUNT_ID);
  });

  it.each([408, 503])("retries an HTTP %i accept outcome with the same command identity", async (status) => {
    const acceptHeaders: Headers[] = [];
    let acceptAttempt = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) return previewResponse("editor");
      if (url.endsWith("/accept") && init?.method === "POST") {
        acceptHeaders.push(new Headers(init.headers));
        acceptAttempt += 1;
        return acceptAttempt === 1
          ? Response.json({ error: "Temporarily unavailable." }, { status })
          : Response.json({ accountId: "account-1", role: "editor" });
      }
      if (url.endsWith("/api/accounts")) {
        return Response.json(acceptAttempt > 1 ? [{ id: "account-1", name: "Wayne Enterprises", role: "editor" }] : []);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderInvite(signedInAuth);
    await user.click(await screen.findByRole("button", { name: "Accept invite" }));

    expect(await screen.findByText((content) => content.includes(m.invite_unknown_refreshed()))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: m.invite_retry_accept() }));

    expect(await screen.findByText("You’ve joined Wayne Enterprises as Editor.")).toBeInTheDocument();
    expect(acceptHeaders).toHaveLength(2);
    expect(acceptHeaders[1]!.get("x-account-command-id")).toBe(acceptHeaders[0]!.get("x-account-command-id"));
    expect(acceptHeaders[1]!.get("idempotency-key")).toBe(acceptHeaders[0]!.get("idempotency-key"));
  });

  it("reports a preview transport failure as safely retryable, not as an unknown mutation outcome", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(previewResponse("editor"));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderInvite(signedInAuth);

    expect(await screen.findByText(m.invite_err_network())).toBeInTheDocument();
    expect(screen.queryByText(/unknown outcome/i)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: m.common_try_again() }));
    expect(await screen.findByTestId("invite-preview")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("submits the existing-user sign-in form and reloads after success", async () => {
    authClientMock.signInEmail.mockResolvedValueOnce({ error: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(previewResponse()));
    const user = userEvent.setup();

    renderInvite({ ...signedInAuth, user: null });
    await screen.findByTestId("invite-preview");
    await user.type(screen.getByLabelText("Email"), "existing@example.com");
    await user.type(screen.getByLabelText("Password"), "existing-password-123");
    await user.click(screen.getByRole("button", { name: m.invite_sign_in_accept() }));

    await vi.waitFor(() => expect(reloadMock.reloadPage).toHaveBeenCalledOnce());
    expect(authClientMock.signInEmail).toHaveBeenCalledWith({
      email: "existing@example.com",
      password: "existing-password-123",
    });
  });

  it("surfaces an existing-user sign-in failure and re-enables the form", async () => {
    authClientMock.signInEmail.mockResolvedValueOnce({ error: { message: "Invalid email or password." } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(previewResponse()));
    const user = userEvent.setup();

    renderInvite({ ...signedInAuth, user: null });
    await screen.findByTestId("invite-preview");
    await user.type(screen.getByLabelText("Email"), "existing@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password-123");
    await user.click(screen.getByRole("button", { name: m.invite_sign_in_accept() }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(screen.getByRole("button", { name: m.invite_sign_in_accept() })).toBeEnabled();
    expect(reloadMock.reloadPage).not.toHaveBeenCalled();
  });

  it("falls back to the account picker when post-signup account refresh fails", async () => {
    authClientMock.signInEmail.mockResolvedValueOnce({ error: null });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) return previewResponse();
      if (url.endsWith("/signup") && init?.method === "POST") {
        return Response.json({ accountId: "joined-account", role: "editor" }, { status: 201 });
      }
      if (url.endsWith("/api/accounts")) return Response.json({ error: "unavailable" }, { status: 500 });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderInvite({ ...signedInAuth, user: null, refreshAuth: vi.fn(async () => {}) });
    await screen.findByTestId("invite-preview");
    await fillInviteCredentials(user);
    await user.click(screen.getByRole("button", { name: m.invite_create_account() }));

    await vi.waitFor(() => expect(handoffMock.replaceWithAccountPicker).toHaveBeenCalledOnce());
    expect(handoffMock.replaceWithJoinedAccount).not.toHaveBeenCalled();
  });

  it("surfaces a provider request rejection and re-enables the provider button", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    authClientMock.signInOauth2.mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(previewResponse()));
    renderInvite({
      ...signedInAuth,
      authMode: "sso",
      user: null,
      providers: [{ id: "sso", label: "Single sign-on", kind: "oidc", experimental: false }],
    });

    const button = await screen.findByRole("button", {
      name: m.invite_continue_provider({ provider: "Single sign-on" }),
    });
    fireEvent.click(button);

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_network_error());
    expect(button).toBeEnabled();
  });

  it("rejects a successful signup response without an account result before signing in", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) return previewResponse();
      if (url.endsWith("/signup") && init?.method === "POST") return Response.json({}, { status: 201 });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderInvite({ ...signedInAuth, user: null });
    await screen.findByTestId("invite-preview");
    await fillInviteCredentials(user);
    await user.click(screen.getByRole("button", { name: m.invite_create_account() }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.invite_signup_invalid_result());
    expect(authClientMock.signInEmail).not.toHaveBeenCalled();
  });

  it("uses the login fallback when post-signup sign-in fails without a message", async () => {
    authClientMock.signInEmail.mockResolvedValueOnce({ error: {} });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) return previewResponse();
      if (url.endsWith("/signup") && init?.method === "POST") {
        return Response.json({ accountId: "joined-account", role: "editor" }, { status: 201 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderInvite({ ...signedInAuth, user: null });
    await screen.findByTestId("invite-preview");
    await fillInviteCredentials(user);
    await user.click(screen.getByRole("button", { name: m.invite_create_account() }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_failed());
  });

  it("reloads the same invite after a transport-unknown signup signs in successfully", async () => {
    authClientMock.signInEmail.mockResolvedValueOnce({ error: null });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) return previewResponse("editor");
      if (url.endsWith("/signup") && init?.method === "POST") throw new TypeError("connection closed");
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderInvite({ ...signedInAuth, user: null });
    await screen.findByTestId("invite-preview");
    await user.type(screen.getByLabelText("Name"), "Existing Person");
    await user.type(screen.getByLabelText("Email"), "existing@example.com");
    await user.type(screen.getByLabelText("Password"), "invite-password-123");
    await user.click(screen.getByRole("button", { name: "Create account and accept" }));

    await vi.waitFor(() => expect(reloadMock.reloadPage).toHaveBeenCalledTimes(1));
    expect(handoffMock.replaceWithJoinedAccount).not.toHaveBeenCalled();
    expect(handoffMock.replaceWithAccountPicker).not.toHaveBeenCalled();
  });

  it("probes sign-in recovery after a server-error signup outcome", async () => {
    authClientMock.signInEmail.mockResolvedValueOnce({ error: null });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) return previewResponse("editor");
      if (url.endsWith("/signup") && init?.method === "POST") {
        return Response.json({ error: "Temporarily unavailable." }, { status: 503 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderInvite({ ...signedInAuth, user: null });
    await screen.findByTestId("invite-preview");
    await user.type(screen.getByLabelText("Name"), "Existing Person");
    await user.type(screen.getByLabelText("Email"), "existing@example.com");
    await user.type(screen.getByLabelText("Password"), "invite-password-123");
    await user.click(screen.getByRole("button", { name: "Create account and accept" }));

    await vi.waitFor(() => expect(reloadMock.reloadPage).toHaveBeenCalledTimes(1));
  });

  it("restores the form when both transport-unknown signup and its sign-in probe fail", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    authClientMock.signInEmail.mockRejectedValueOnce(new TypeError("still offline"));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) return previewResponse("editor");
      if (url.endsWith("/signup") && init?.method === "POST") throw new TypeError("connection closed");
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderInvite({ ...signedInAuth, user: null });
    await screen.findByTestId("invite-preview");
    await user.type(screen.getByLabelText("Name"), "Existing Person");
    await user.type(screen.getByLabelText("Email"), "existing@example.com");
    await user.type(screen.getByLabelText("Password"), "invite-password-123");
    await user.click(screen.getByRole("button", { name: "Create account and accept" }));

    expect(await screen.findByText(m.invite_signup_unknown())).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account and accept" })).toBeEnabled();
    expect(reloadMock.reloadPage).not.toHaveBeenCalled();
  });

  it("uses a new command when credential input changes after an unknown signup outcome", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    authClientMock.signInEmail.mockRejectedValueOnce(new TypeError("still offline"));
    const signupHeaders: Headers[] = [];
    let signupAttempt = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) return previewResponse("editor");
      if (url.endsWith("/signup") && init?.method === "POST") {
        signupHeaders.push(new Headers(init.headers));
        signupAttempt += 1;
        if (signupAttempt === 1) throw new TypeError("connection closed");
        return Response.json(
          {
            error: "The invitation is no longer available.",
            code: "INVITATION_USED",
          },
          { status: 409 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderInvite({ ...signedInAuth, user: null });
    await screen.findByTestId("invite-preview");
    await user.type(screen.getByLabelText("Name"), "Existing Person");
    await user.type(screen.getByLabelText("Email"), "existing@example.com");
    await user.type(screen.getByLabelText("Password"), "invite-password-123");
    await user.click(screen.getByRole("button", { name: "Create account and accept" }));
    await screen.findByText(m.invite_signup_unknown());

    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "corrected@example.com");
    await user.click(screen.getByRole("button", { name: "Create account and accept" }));
    await screen.findByText("The invitation is no longer available.");

    expect(signupHeaders).toHaveLength(2);
    expect(signupHeaders[1]!.get("x-account-command-id")).not.toBe(signupHeaders[0]!.get("x-account-command-id"));
  });
});
