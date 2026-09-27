import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { AuthContext, type AuthContextValue } from "../../auth/authContext";
import { m } from "@/i18n";
import { SecuritySection } from "./SecuritySection";

const changePassword = vi.fn();
const getIdentityProvider = vi.fn();
vi.mock("../../auth/authClient", () => ({
  authClient: { changePassword: (...args: unknown[]) => changePassword(...args) },
}));
vi.mock("../../account/accountClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../account/accountClient")>();
  return {
    ...original,
    accountClient: {
      ...original.accountClient,
      getIdentityProvider: (...args: unknown[]) => getIdentityProvider(...args),
    },
  };
});

beforeEach(() => {
  changePassword.mockReset();
  getIdentityProvider
    .mockReset()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ connected: true, verified: true }), { status: 200 })),
    );
});

const passwordAuth: AuthContextValue = {
  authMode: "password-only",
  user: { id: "u1", email: "diana@example.test", twoFactorEnabled: true },
  providers: [],
  canCreateAccount: false,
  multiAccount: false,
  refreshAuth: async () => {},
  signOut: async () => {},
};

function renderSecurity(overrides: Partial<AuthContextValue> = {}, passwordOpen = false) {
  const auth: AuthContextValue = { ...passwordAuth, ...overrides };
  return render(
    <AuthContext.Provider value={auth}>
      <SecuritySection passwordOpen={passwordOpen} />
    </AuthContext.Provider>,
  );
}

it("keeps password controls hidden until the password dialog is opened", () => {
  renderSecurity();
  expect(screen.queryByLabelText(m.settings_security_current_password())).not.toBeInTheDocument();
});

it("changes a password through the dialog and revokes other sessions", async () => {
  changePassword.mockResolvedValue({ data: { status: true }, error: null });
  renderSecurity({}, true);
  fireEvent.change(screen.getByLabelText(m.settings_security_current_password()), {
    target: { value: "current-password" },
  });
  fireEvent.change(screen.getByLabelText(m.settings_security_new_password()), {
    target: { value: "a-strong-new-password" },
  });
  fireEvent.change(screen.getByLabelText(m.settings_security_confirm_password()), {
    target: { value: "a-strong-new-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: m.settings_security_change_password() }));
  await waitFor(() =>
    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: "current-password",
      newPassword: "a-strong-new-password",
      revokeOtherSessions: true,
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(m.settings_security_password_changed());
});

it("keeps password mismatch validation in the dialog", async () => {
  renderSecurity({}, true);
  fireEvent.change(screen.getByLabelText(m.settings_security_current_password()), {
    target: { value: "current-password" },
  });
  fireEvent.change(screen.getByLabelText(m.settings_security_new_password()), {
    target: { value: "a-strong-new-password" },
  });
  fireEvent.change(screen.getByLabelText(m.settings_security_confirm_password()), {
    target: { value: "different-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: m.settings_security_change_password() }));
  expect(await screen.findByRole("alert")).toHaveTextContent(m.settings_security_err_password_mismatch());
  expect(changePassword).not.toHaveBeenCalled();
});

it("clears password values and errors when the dialog closes", async () => {
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open password dialog</button>
        <SecuritySection passwordOpen={open} onPasswordOpenChange={setOpen} />
      </>
    );
  }
  render(
    <AuthContext.Provider value={passwordAuth}>
      <Harness />
    </AuthContext.Provider>,
  );
  fireEvent.change(screen.getByLabelText(m.settings_security_current_password()), {
    target: { value: "current-password" },
  });
  fireEvent.change(screen.getByLabelText(m.settings_security_new_password()), {
    target: { value: "a-strong-new-password" },
  });
  fireEvent.change(screen.getByLabelText(m.settings_security_confirm_password()), {
    target: { value: "different-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: m.settings_security_change_password() }));
  expect(await screen.findByRole("alert")).toHaveTextContent(m.settings_security_err_password_mismatch());
  fireEvent.click(screen.getByRole("button", { name: m.form_cancel() }));
  fireEvent.click(screen.getByRole("button", { name: "Open password dialog" }));
  expect(screen.getByLabelText(m.settings_security_current_password())).toHaveValue("");
  expect(screen.getByLabelText(m.settings_security_new_password())).toHaveValue("");
  expect(screen.getByLabelText(m.settings_security_confirm_password())).toHaveValue("");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("does not restore stale values or feedback after a pending password request finishes", async () => {
  let finish: ((value: unknown) => void) | undefined;
  changePassword.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open password dialog</button>
        <SecuritySection passwordOpen={open} onPasswordOpenChange={setOpen} />
      </>
    );
  }
  render(
    <AuthContext.Provider value={passwordAuth}>
      <Harness />
    </AuthContext.Provider>,
  );
  fireEvent.change(screen.getByLabelText(m.settings_security_current_password()), {
    target: { value: "current-password" },
  });
  fireEvent.change(screen.getByLabelText(m.settings_security_new_password()), {
    target: { value: "a-strong-new-password" },
  });
  fireEvent.change(screen.getByLabelText(m.settings_security_confirm_password()), {
    target: { value: "a-strong-new-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: m.settings_security_change_password() }));
  await waitFor(() => expect(changePassword).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: m.form_cancel() }));
  fireEvent.click(screen.getByRole("button", { name: "Open password dialog" }));
  expect(screen.getByLabelText(m.settings_security_current_password())).toHaveValue("");
  const finishRequest = finish;
  if (!finishRequest) throw new Error("Password request was not started");
  await act(async () => finishRequest({ data: { status: true }, error: null }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByLabelText(m.settings_security_current_password())).toHaveValue("");
});

it("does not mount a password dialog for a federated identity in password mode", () => {
  renderSecurity({ reauthMethod: "provider" }, true);
  expect(screen.queryByRole("dialog", { name: m.settings_security_change_password() })).not.toBeInTheDocument();
});

it.each([
  { required: true, enrolled: true, expected: m.account_mfa_enabled() },
  { required: true, enrolled: false, expected: m.account_mfa_not_enabled() },
  { required: false, enrolled: true, expected: null },
])("shows MFA status only under operator policy ($required, $enrolled)", ({ required, enrolled, expected }) => {
  renderSecurity({ requireMfa: required, user: { id: "u1", twoFactorEnabled: enrolled } });
  if (expected) expect(screen.getByText(expected)).toBeInTheDocument();
  else expect(screen.queryByText(m.account_mfa_title())).not.toBeInTheDocument();
});

it("preserves Microsoft identity-link status without password controls", async () => {
  renderSecurity({
    authMode: "sso-only",
    providers: [{ id: "microsoft", label: "Microsoft", kind: "social", experimental: false }],
  });
  expect(await screen.findByText(m.settings_sso_connected({ provider: "Microsoft" }))).toBeInTheDocument();
  expect(screen.queryByLabelText(m.settings_security_current_password())).not.toBeInTheDocument();
});

it("shows Google and Microsoft connection status independently", async () => {
  getIdentityProvider.mockImplementation((providerId: string) =>
    Promise.resolve(
      new Response(JSON.stringify({ connected: providerId === "google", verified: providerId === "google" })),
    ),
  );
  renderSecurity({
    providers: [
      { id: "google", label: "Google", kind: "social", experimental: false },
      { id: "microsoft", label: "Microsoft", kind: "social", experimental: false },
      { id: "github", label: "GitHub", kind: "social", experimental: true },
    ],
  });
  expect(await screen.findByText(m.settings_sso_connected({ provider: "Google" }))).toBeInTheDocument();
  expect(
    await screen.findByRole("button", { name: m.settings_sso_connect_button({ provider: "Microsoft" }) }),
  ).toBeInTheDocument();
  expect(screen.queryByText(m.settings_sso_connected({ provider: "Microsoft" }))).not.toBeInTheDocument();
  expect(getIdentityProvider).not.toHaveBeenCalledWith("github");
});

it("keeps a Microsoft callback error on its own connection", async () => {
  window.history.replaceState(
    null,
    "",
    "/account?capacitylensIdentityProvider=microsoft&capacitylensSsoLinkFailed=attempt",
  );
  renderSecurity({
    providers: [
      { id: "google", label: "Google", kind: "social", experimental: false },
      { id: "microsoft", label: "Microsoft", kind: "social", experimental: false },
    ],
  });
  expect(await screen.findAllByText(m.settings_sso_connect_error())).toHaveLength(1);
  expect(screen.getByText(m.settings_sso_connected({ provider: "Google" }))).toBeInTheDocument();
  expect(window.location.search).toBe("");
});

it("preserves a provider callback error through StrictMode replay and provider refresh", async () => {
  window.history.replaceState(
    null,
    "",
    "/account?capacitylensIdentityProvider=google&capacitylensSsoLinkFailed=attempt",
  );
  const auth: AuthContextValue = {
    ...passwordAuth,
    providers: [{ id: "google", label: "Google", kind: "social", experimental: false }],
  };
  const view = render(
    <StrictMode>
      <AuthContext.Provider value={auth}>
        <SecuritySection />
      </AuthContext.Provider>
    </StrictMode>,
  );

  expect(await screen.findByText(m.settings_sso_connected({ provider: "Google" }))).toBeInTheDocument();
  expect(await screen.findByText(m.settings_sso_connect_error())).toBeInTheDocument();

  view.rerender(
    <StrictMode>
      <AuthContext.Provider
        value={{
          ...auth,
          providers: [{ id: "google", label: "Google", kind: "social", experimental: false }],
        }}
      >
        <SecuritySection />
      </AuthContext.Provider>
    </StrictMode>,
  );

  await waitFor(() => expect(getIdentityProvider).toHaveBeenCalledTimes(3));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(await screen.findByText(m.settings_sso_connect_error())).toBeInTheDocument();
  expect(window.location.search).toBe("");
});

it("does not restore a callback error after an already-linked retry and provider refresh", async () => {
  window.history.replaceState(
    null,
    "",
    "/account?capacitylensIdentityProvider=google&capacitylensSsoLinkFailed=attempt",
  );
  const auth: AuthContextValue = {
    ...passwordAuth,
    providers: [{ id: "google", label: "Google", kind: "social", experimental: false }],
  };
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: "PROVIDER_ALREADY_LINKED" }, { status: 409 }));
  vi.stubGlobal("fetch", fetchMock);
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  let finishPendingStatus: ((response: Response) => void) | undefined;
  getIdentityProvider.mockResolvedValueOnce(Response.json({ connected: false, verified: false }));
  getIdentityProvider.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishPendingStatus = resolve;
      }),
  );

  const view = render(
    <AuthContext.Provider value={auth}>
      <SecuritySection />
    </AuthContext.Provider>,
  );
  try {
    expect(await screen.findByText(m.settings_sso_connect_error())).toBeInTheDocument();
    view.rerender(
      <AuthContext.Provider
        value={{
          ...auth,
          providers: [{ id: "google", label: "Google", kind: "social", experimental: false }],
        }}
      >
        <SecuritySection />
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(getIdentityProvider).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: m.settings_sso_connect_button({ provider: "Google" }) }));
    expect(await screen.findByText(m.settings_sso_connected({ provider: "Google" }))).toBeInTheDocument();
    expect(screen.queryByText(m.settings_sso_connect_error())).not.toBeInTheDocument();

    const finishStatus = finishPendingStatus;
    if (!finishStatus) throw new Error("Provider status refresh was not started");
    await act(async () => finishStatus(Response.json({ connected: false, verified: false })));
    expect(screen.getByText(m.settings_sso_connected({ provider: "Google" }))).toBeInTheDocument();
    expect(screen.queryByText(m.settings_sso_connect_error())).not.toBeInTheDocument();

    getIdentityProvider.mockResolvedValue(Response.json({ connected: true, verified: true }));
    view.rerender(
      <AuthContext.Provider
        value={{
          ...auth,
          providers: [{ id: "google", label: "Google", kind: "social", experimental: false }],
        }}
      >
        <SecuritySection />
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(getIdentityProvider).toHaveBeenCalledTimes(3));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(m.settings_sso_connected({ provider: "Google" }))).toBeInTheDocument();
    expect(screen.queryByText(m.settings_sso_connect_error())).not.toBeInTheDocument();
  } finally {
    errorLog.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("dispatches Microsoft connection through the shared identity route and retains its return marker", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: "PROVIDER_UNAVAILABLE" }, { status: 502 }));
  vi.stubGlobal("fetch", fetchMock);
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  window.history.replaceState(null, "", "/account");
  getIdentityProvider.mockResolvedValue(Response.json({ connected: false, verified: false }));
  try {
    renderSecurity({
      providers: [{ id: "microsoft", label: "Microsoft", kind: "social", experimental: false }],
    });
    fireEvent.click(
      await screen.findByRole("button", { name: m.settings_sso_connect_button({ provider: "Microsoft" }) }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/identity/link-provider");
    expect(init.credentials).toBe("include");
    const body = JSON.parse(String(init.body)) as { providerId: string; callbackURL: string; errorCallbackURL: string };
    expect(body.providerId).toBe("microsoft");
    expect(new URL(body.callbackURL).searchParams.get("capacitylensIdentityProvider")).toBe("microsoft");
    expect(body.errorCallbackURL).toBe(body.callbackURL);
    expect(await screen.findByText(m.settings_sso_connect_error())).toBeInTheDocument();
  } finally {
    errorLog.mockRestore();
    vi.unstubAllGlobals();
  }
});
