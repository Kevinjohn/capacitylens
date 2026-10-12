import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext } from "@/auth/authContext";
import type { AuthContextValue } from "@/auth/authContext";
import { m } from "@/i18n";
import { InviteAccept } from "./InviteAccept";

const signInEmail = vi.hoisted(() => vi.fn());
vi.mock("@/auth/authClient", () => ({ authClient: { signIn: { email: signInEmail } } }));
vi.mock("@/data/apiConfig", () => ({ API_BASE: "http://api.test", isServerConfigured: () => true }));

const signedOutAuth: AuthContextValue = {
  authMode: "password-only",
  user: null,
  canCreateAccount: true,
  multiAccount: true,
  refreshAuth: async () => {},
  signOut: async () => {},
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        accountName: "Wayne Enterprises",
        role: "editor",
        expiresAt: "2999-01-01T00:00:00.000Z",
      }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderInvite() {
  return render(
    <AuthContext.Provider value={signedOutAuth}>
      <MemoryRouter initialEntries={["/invite/secret-token"]}>
        <Routes>
          <Route path="/invite/:token" element={<InviteAccept />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

it.each(["p".repeat(257), "𠀀".repeat(129)])(
  "retains an oversized existing password and rejects it before sign-in",
  async (value) => {
    const user = userEvent.setup();
    renderInvite();
    await screen.findByTestId("invite-preview");
    await user.type(screen.getByLabelText("Email"), "existing@example.com");
    const password = screen.getByLabelText("Password");
    await user.click(password);
    await user.paste(value);
    expect(password).toHaveValue(value);
    await user.click(screen.getByRole("button", { name: m.invite_sign_in_accept() }));
    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_password_input_too_long());
    expect(signInEmail).not.toHaveBeenCalled();
  },
);
