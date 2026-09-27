import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext, type AuthContextValue } from "../../auth/authContext";
import { JoinCompany } from "./JoinCompany";

const authClientMock = vi.hoisted(() => ({ signInEmail: vi.fn() }));
const handoffMock = vi.hoisted(() => ({ replaceWithJoinedAccount: vi.fn() }));

vi.mock("../../auth/authClient", () => ({ authClient: { signIn: { email: authClientMock.signInEmail } } }));
vi.mock("../../data/apiConfig", () => ({ API_BASE: "http://api.test", isServerConfigured: () => true }));
vi.mock("../../lib/joinedAccountHandoff", () => ({ replaceWithJoinedAccount: handoffMock.replaceWithJoinedAccount }));

const auth: AuthContextValue = {
  authMode: "password-only", user: null, canCreateAccount: false, multiAccount: true,
  refreshAuth: vi.fn(async () => {}), signOut: vi.fn(async () => {}),
};

function renderJoin(path = "/join/a-studio") {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/join/:accountId" element={<JoinCompany />} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

function stubJoin(status: Record<string, unknown>, extra?: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/join/metadata")) return Response.json({
      accountId: "a-studio", companyName: "Wayne Enterprises", passwordAvailable: true, providerAvailable: false,
    });
    if (url.endsWith("/api/company-join/status")) return Response.json(status);
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

it("does not ask a new invitee for a password until the company-bound mailbox proof is complete", async () => {
  const fetchMock = stubJoin({ state: "expired" }, (url) => {
    if (url.endsWith("/join/start")) return Response.json({ emailHint: "b***@example.test", expiresAt: "2999-01-01" });
    throw new Error(`Unexpected request: ${url}`);
  });
  const user = userEvent.setup();
  renderJoin("/join/a-studio?invite=invite-token");

  expect(await screen.findByRole("heading", { name: "Join Wayne Enterprises" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Email"), "barbara@example.test");
  await user.click(screen.getByRole("button", { name: "Send verification email" }));

  expect(await screen.findByText(/Check b\*\*\*@example\.test/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  const start = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/join/start"));
  expect(start).toBeDefined();
  expect(JSON.parse(String(start?.[1]?.body))).toEqual({
    purpose: "invitation", email: "barbara@example.test", invitationToken: "invite-token",
  });
});

it("requires the same-browser mail token before showing password creation", async () => {
  const fetchMock = stubJoin({
    state: "pending", accountId: "a-studio", purpose: "policy", email: "barbara@example.test",
    emailHint: "b***@example.test",
  }, (url) => {
    if (url.endsWith("/api/company-join/confirm")) return Response.json({ state: "approved" });
    throw new Error(`Unexpected request: ${url}`);
  });
  window.history.replaceState({}, "", "/join/a-studio#token=mail-secret");
  renderJoin();

  expect(await screen.findByRole("button", { name: "Create account and join" })).toBeInTheDocument();
  const confirm = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/company-join/confirm"));
  expect(confirm).toBeDefined();
  expect(JSON.parse(String(confirm?.[1]?.body))).toEqual({ token: "mail-secret" });
  expect(window.location.hash).toBe("");
});

it("creates credentials only after an approved intent and activates the joined company", async () => {
  const fetchMock = stubJoin({
    state: "approved", accountId: "a-studio", purpose: "policy", email: "barbara@example.test",
  }, (url) => {
    if (url.endsWith("/api/company-join/complete-password")) return Response.json({ accountId: "a-studio" });
    throw new Error(`Unexpected request: ${url}`);
  });
  const user = userEvent.setup();
  renderJoin();

  await user.type(await screen.findByLabelText("Name"), "Barbara Gordon");
  await user.type(screen.getByLabelText("Password", { selector: "[autocomplete='new-password']" }),
    "a-long-enough-password");
  await user.click(screen.getByRole("button", { name: "Create account and join" }));

  await vi.waitFor(() => expect(handoffMock.replaceWithJoinedAccount).toHaveBeenCalledWith("a-studio"));
  const complete = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/company-join/complete-password"));
  expect(JSON.parse(String(complete?.[1]?.body))).toEqual({
    displayName: "Barbara Gordon", password: "a-long-enough-password",
  });
  expect(authClientMock.signInEmail).toHaveBeenCalledWith({
    email: "barbara@example.test", password: "a-long-enough-password",
  });
});
