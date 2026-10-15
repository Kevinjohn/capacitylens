import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext } from "@/auth/authContext";
import type { AuthContextValue } from "@/auth/authContext";
import { JoinCompany } from "./JoinCompany";

const authClientMock = vi.hoisted(() => ({ signInEmail: vi.fn() }));
const handoffMock = vi.hoisted(() => ({ replaceWithJoinedAccount: vi.fn() }));
vi.mock("@/auth/authClient", () => ({
  authClient: {
    signIn: { email: authClientMock.signInEmail },
  },
}));
vi.mock("@/data/apiConfig", () => ({ API_BASE: "http://api.test", isServerConfigured: () => true }));
vi.mock("@/lib/joinedAccountHandoff", () => ({ replaceWithJoinedAccount: handoffMock.replaceWithJoinedAccount }));

const auth: AuthContextValue = {
  authMode: "password-only",
  user: null,
  canCreateAccount: false,
  multiAccount: true,
  refreshAuth: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
};

function renderJoin(path = "/join/a-studio", context = auth) {
  return render(
    <AuthContext.Provider value={context}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/join/:accountId" element={<JoinCompany />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

type StubJoinOptions = {
  extra?: ((url: string, init?: RequestInit) => Response) | undefined;
  providerAvailable?: boolean;
  status?: (() => Record<string, unknown>) | undefined;
};
function stubJoin({ extra, providerAvailable = false, status = () => ({ state: "expired" }) }: StubJoinOptions) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/join/metadata"))
      return Response.json({
        accountId: "a-studio",
        companyName: "Wayne Enterprises",
        passwordAvailable: true,
        providerAvailable,
        emailVerificationAvailable: true,
      });
    if (url.endsWith("/api/company-join/status")) return Response.json(status());
    if (extra) return extra(url, init);
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/join/a-studio");
  vi.clearAllMocks();
  authClientMock.signInEmail.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllGlobals());

it("shows only the available Google provider above existing password in company-sign-in-only mode", async () => {
  stubJoin({ extra: undefined, providerAvailable: true });
  renderJoin("/join/a-studio", {
    ...auth,
    authMode: "sso-only",
    providers: [{ id: "google", label: "Google", kind: "social", experimental: false }],
  });
  expect(await screen.findByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
  expect(screen.queryByText("Or sign in with your password")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
});

it("uses the company-bound Google start with the addressed invitation", async () => {
  const fetchMock = stubJoin({
    extra: (url) => {
      if (url.endsWith("/api/accounts/a-studio/join/provider/start"))
        return Response.json({ url: "https://accounts.google.test/authorize" });
      throw new Error(`Unexpected request: ${url}`);
    },
    providerAvailable: true,
  });
  const user = userEvent.setup();
  renderJoin("/join/a-studio?invite=invite-token", {
    ...auth,
    authMode: "sso-only",
    providers: [{ id: "google", label: "Google", kind: "social", experimental: false }],
  });
  await user.type(await screen.findByLabelText("Email"), "diana@example.test");
  await user.click(screen.getByRole("button", { name: "Sign in with Google" }));
  await vi.waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/accounts/a-studio/join/provider/start")),
    ).toBe(true),
  );
  const start = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/api/accounts/a-studio/join/provider/start"),
  );
  expect(JSON.parse(String(start?.[1]?.body))).toMatchObject({
    purpose: "invitation",
    email: "diana@example.test",
    invitationToken: "invite-token",
    providerId: "google",
  });
  window.dispatchEvent(new Event("pagehide"));
});

it("restarts a pending Google callback journey through its same-browser cancellation route", async () => {
  const fetchMock = stubJoin({
    extra: (url) => {
      if (url.endsWith("/api/company-join/cancel")) return Response.json({ ok: true });
      throw new Error(`Unexpected request: ${url}`);
    },
    providerAvailable: true,
    status: () => ({
      state: "pending",
      accountId: "a-studio",
      purpose: "policy",
      providerId: "google",
      emailHint: "diana@example.test",
    }),
  });
  const user = userEvent.setup();
  renderJoin("/join/a-studio", {
    ...auth,
    providers: [{ id: "google", label: "Google", kind: "social", experimental: false }],
  });
  expect(await screen.findByText("Checking company joining…")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Start again" }));
  expect(await screen.findByLabelText("Email")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "http://api.test/api/company-join/cancel",
    expect.objectContaining({ method: "POST" }),
  );
  expect(screen.queryByRole("button", { name: "Resend email" })).not.toBeInTheDocument();
});

it("signs in an existing password identity and joins only through the policy endpoint", async () => {
  const fetchMock = stubJoin({
    extra: (url) => {
      if (url.endsWith("/api/accounts/a-studio/join/complete-existing"))
        return Response.json({ accountId: "a-studio", role: "viewer" });
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const user = userEvent.setup();
  renderJoin();
  await user.type(await screen.findByLabelText("Email"), "barbara@example.test");
  await user.type(screen.getByLabelText("Password"), "password");
  await user.click(screen.getByRole("button", { name: "Join company" }));
  await vi.waitFor(() => expect(handoffMock.replaceWithJoinedAccount).toHaveBeenCalledWith("a-studio"));
  expect(authClientMock.signInEmail).toHaveBeenCalledWith({ email: "barbara@example.test", password: "password" });
  const completion = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/api/accounts/a-studio/join/complete-existing"),
  );
  expect(JSON.parse(String(completion?.[1]?.body))).toEqual({});
  expect(screen.queryByRole("button", { name: "Create account and join" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send verification email" })).not.toBeInTheDocument();
});

it("accepts the shared long email and password limits and normalizes a pasted email", async () => {
  stubJoin({
    extra: (url) => {
      if (url.endsWith("/api/accounts/a-studio/join/complete-existing"))
        return Response.json({ accountId: "a-studio", role: "viewer" });
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const user = userEvent.setup();
  renderJoin();
  const email = await screen.findByLabelText("Email");
  const password = screen.getByLabelText("Password");
  expect(email).not.toHaveAttribute("maxlength");
  expect(password).not.toHaveAttribute("maxlength");
  const longEmail = `${"a".repeat(189)}@example.test`;
  const longPassword = "𠀀".repeat(101);
  await user.type(email, `${" ".repeat(30)}${longEmail.toUpperCase()}${" ".repeat(30)}`);
  await user.type(password, longPassword);
  await user.click(screen.getByRole("button", { name: "Join company" }));
  await vi.waitFor(() =>
    expect(authClientMock.signInEmail).toHaveBeenCalledWith({ email: longEmail, password: longPassword }),
  );
});

it.each(["p".repeat(257), "𠀀".repeat(129)])(
  "keeps an oversized pasted password visible and rejects it before sign-in",
  async (value) => {
    stubJoin({});
    const user = userEvent.setup();
    renderJoin();
    await user.type(await screen.findByLabelText("Email"), "barbara@example.test");
    const password = screen.getByLabelText("Password");
    await user.click(password);
    await user.paste(value);
    expect(password).toHaveValue(value);
    await user.click(screen.getByRole("button", { name: "Join company" }));
    expect(await screen.findByText(/password.*too long/i)).toBeInTheDocument();
    expect(authClientMock.signInEmail).not.toHaveBeenCalled();
  },
);

it("shows a field error for malformed join email before trying credentials", async () => {
  stubJoin({});
  const user = userEvent.setup();
  renderJoin();
  await user.type(await screen.findByLabelText("Email"), "bad-address");
  await user.type(screen.getByLabelText("Password"), "password");
  await user.click(screen.getByRole("button", { name: "Join company" }));
  expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
  expect(authClientMock.signInEmail).not.toHaveBeenCalled();
});

it("explains missing trusted proof and offers the addressed password invitation", async () => {
  stubJoin({
    extra: (url) => {
      if (url.endsWith("/api/accounts/a-studio/join/complete-existing"))
        return Response.json({ error: "proof unavailable" }, { status: 401 });
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const user = userEvent.setup();
  renderJoin();
  await user.type(await screen.findByLabelText("Email"), "barbara@example.test");
  await user.type(screen.getByLabelText("Password"), "password");
  await user.click(screen.getByRole("button", { name: "Join company" }));
  expect(await screen.findByText(/no current trusted proof/i)).toBeInTheDocument();
});

it("routes an addressed password invitation to ordinary invitation acceptance", async () => {
  stubJoin({});
  renderJoin("/join/a-studio?invite=invite-token");
  expect(await screen.findByRole("link", { name: "Use this invitation with a password" })).toHaveAttribute(
    "href",
    "/invite/invite-token",
  );
  expect(screen.queryByRole("button", { name: "Join company" })).not.toBeInTheDocument();
});

it("offers email verification when proof is required and sends to the saved address", async () => {
  const fetchMock = stubJoin({
    extra: (url) => {
      if (url.endsWith("/join/complete-existing"))
        return Response.json({ error: "proof unavailable" }, { status: 401 });
      if (url.endsWith("/join/verify-email")) return Response.json({ sent: true });
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const user = userEvent.setup();
  renderJoin();
  await user.type(await screen.findByLabelText("Email"), "barbara@example.test");
  await user.type(screen.getByLabelText("Password"), "password");
  await user.click(screen.getByRole("button", { name: "Join company" }));
  expect(await screen.findByTestId("joining-verify-email")).toHaveAccessibleName("Email me a verification link");
  await user.click(screen.getByTestId("joining-verify-email"));
  expect(await screen.findByTestId("joining-verify-email-status")).toHaveTextContent(
    "Check your inbox for a link to verify your email.",
  );
  const sent = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/join/verify-email"));
  expect(JSON.parse(String(sent?.[1]?.body))).toEqual({});
});

it("holds the verification fragment through sign-in and confirms it before joining", async () => {
  window.history.replaceState({}, "", "/join/a-studio#verify=mail-proof");
  const requests: string[] = [];
  stubJoin({
    extra: (url, init) => {
      requests.push(url);
      if (url.endsWith("/api/company-join/verify-email")) {
        expect(JSON.parse(String(init?.body))).toEqual({ token: "mail-proof" });
        return Response.json({ ok: true });
      }
      if (url.endsWith("/join/complete-existing")) return Response.json({ accountId: "a-studio", role: "viewer" });
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const user = userEvent.setup();
  renderJoin();
  await user.type(await screen.findByLabelText("Email"), "barbara@example.test");
  expect(window.location.hash).toBe("");
  await user.type(screen.getByLabelText("Password"), "password");
  await user.click(screen.getByRole("button", { name: "Join company" }));
  await vi.waitFor(() => expect(handoffMock.replaceWithJoinedAccount).toHaveBeenCalledWith("a-studio"));
  expect(requests).toEqual([
    "http://api.test/api/company-join/verify-email",
    "http://api.test/api/accounts/a-studio/join/complete-existing",
  ]);
});

it("drops a rejected verification fragment so the next attempt can request a new link", async () => {
  window.history.replaceState({}, "", "/join/a-studio#verify=expired-proof");
  const requests: string[] = [];
  stubJoin({
    extra: (url) => {
      requests.push(url);
      if (url.endsWith("/api/company-join/verify-email")) {
        return Response.json({ error: { code: "INVALID", message: "Invalid request." } }, { status: 400 });
      }
      if (url.endsWith("/join/complete-existing")) return new Response(null, { status: 401 });
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const user = userEvent.setup();
  renderJoin();
  await user.type(await screen.findByLabelText("Email"), "barbara@example.test");
  await user.type(screen.getByLabelText("Password"), "password");
  await user.click(screen.getByRole("button", { name: "Join company" }));
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  await user.click(screen.getByRole("button", { name: "Join company" }));
  expect(await screen.findByTestId("joining-verify-email")).toBeInTheDocument();
  expect(requests).toEqual([
    "http://api.test/api/company-join/verify-email",
    "http://api.test/api/accounts/a-studio/join/complete-existing",
  ]);
});

it("does not offer email verification where the server cannot send it", async () => {
  const fetchMock = stubJoin({
    extra: (url) => {
      if (url.endsWith("/join/complete-existing"))
        return Response.json({ error: "proof unavailable" }, { status: 401 });
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const stubbed = fetchMock.getMockImplementation();
  if (!stubbed) throw new Error("Expected the join fetch stub.");
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith("/join/metadata")
      ? Response.json({
          accountId: "a-studio",
          companyName: "Wayne Enterprises",
          passwordAvailable: true,
          providerAvailable: false,
          emailVerificationAvailable: false,
        })
      : stubbed(input, init),
  );
  const user = userEvent.setup();
  renderJoin();
  await user.type(await screen.findByLabelText("Email"), "barbara@example.test");
  await user.type(screen.getByLabelText("Password"), "password");
  await user.click(screen.getByRole("button", { name: "Join company" }));
  expect(await screen.findByText(/no current trusted proof of its email address/)).toBeInTheDocument();
  expect(screen.queryByTestId("joining-verify-email")).not.toBeInTheDocument();
});

it("completes an approved Google invitation explicitly after the token-free callback", async () => {
  const status = {
    state: "approved",
    accountId: "a-studio",
    purpose: "invitation",
    providerId: "google",
    email: "diana@example.test",
  };
  const fetchMock = stubJoin({
    extra: (url) => {
      if (url.endsWith("/api/company-join/complete-provider"))
        return Response.json({ accountId: "a-studio", role: "viewer" });
      throw new Error(`Unexpected request: ${url}`);
    },
    providerAvailable: true,
    status: () => status,
  });
  const refreshAuth = vi.fn(async () => {
    expect(handoffMock.replaceWithJoinedAccount).not.toHaveBeenCalled();
  });
  const user = userEvent.setup();
  renderJoin("/join/a-studio", {
    ...auth,
    refreshAuth,
    providers: [{ id: "google", label: "Google", kind: "social", experimental: false }],
  });
  expect(
    await screen.findByText("Your sign-in provider verified this address. Join this company to finish."),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Join company" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Join company");
  expect(fetchMock).toHaveBeenCalledWith(
    "http://api.test/api/company-join/complete-provider",
    expect.objectContaining({ method: "POST", body: JSON.stringify({}) }),
  );
  expect(refreshAuth).toHaveBeenCalledTimes(1);
  expect(handoffMock.replaceWithJoinedAccount).toHaveBeenCalledExactlyOnceWith("a-studio");
  expect(screen.queryByRole("button", { name: "Join company" })).not.toBeInTheDocument();
});

it("keeps the pending Google journey retryable when cancellation fails", async () => {
  const fetchMock = stubJoin({
    extra: (url) => {
      if (url.endsWith("/api/company-join/cancel"))
        return Response.json({ error: "Could not cancel provider sign-in" }, { status: 503 });
      throw new Error(`Unexpected request: ${url}`);
    },
    providerAvailable: true,
    status: () => ({
      state: "pending",
      accountId: "a-studio",
      purpose: "policy",
      providerId: "google",
      emailHint: "diana@example.test",
    }),
  });
  const user = userEvent.setup();
  renderJoin("/join/a-studio", {
    ...auth,
    providers: [{ id: "google", label: "Google", kind: "social", experimental: false }],
  });
  await user.click(await screen.findByRole("button", { name: "Start again" }));
  expect(await screen.findByText("Could not cancel provider sign-in")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start again" })).toBeEnabled();
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "http://api.test/api/company-join/cancel",
    expect.objectContaining({ method: "POST" }),
  );
});
