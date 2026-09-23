import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { InviteAccept } from "./InviteAccept";
import { AuthContext, type AuthContextValue } from "../../auth/authContext";

const authClientMock = vi.hoisted(() => ({ signInSocial: vi.fn(async () => ({ error: null })) }));
vi.mock("../../auth/authClient", () => ({
  authClient: { signIn: { social: authClientMock.signInSocial } },
}));
vi.mock("../../data/apiConfig", () => ({ API_BASE: "http://api.test", isServerConfigured: () => true }));
vi.mock("../../lib/reloadPage", () => ({ reloadPage: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const previewResponse = (): Response =>
  ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      accountName: "Wayne Enterprises",
      role: "editor",
      expiresAt: "2999-01-01T00:00:00.000Z",
    }),
  }) as Response;

const signedOutAuth: AuthContextValue = {
  authMode: "password",
  user: null,
  providers: [{ id: "microsoft", label: "Microsoft", kind: "social", brand: "microsoft", experimental: false }],
  canCreateAccount: true,
  multiAccount: true,
  refreshAuth: async () => {},
  signOut: async () => {},
};

function renderInvite(auth: AuthContextValue) {
  const content = (
    <MemoryRouter initialEntries={["/invite/secret-token"]}>
      <Routes>
        <Route path="/invite/:token" element={<InviteAccept />} />
      </Routes>
    </MemoryRouter>
  );
  return render(<AuthContext.Provider value={auth}>{content}</AuthContext.Provider>);
}

describe("InviteAccept — Microsoft verification", () => {
  it("starts invite verification with the route token and keeps the browser redirect lifecycle", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(previewResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: "https://login.microsoftonline.com/authorize" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderInvite(signedOutAuth);

    await screen.findByTestId("invite-preview");
    await user.click(screen.getByRole("button", { name: "Sign in with Microsoft" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [startUrl, startInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(startUrl).toBe("http://api.test/api/account/microsoft/start");
    expect(startInit.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(startInit.body))).toMatchObject({
      purpose: "invite",
      inviteToken: "secret-token",
      callbackURL: window.location.href,
    });
    expect(authClientMock.signInSocial).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pagehide"));
  });
});
