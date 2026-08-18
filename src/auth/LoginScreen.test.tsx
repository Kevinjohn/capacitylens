import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock the Better Auth client so the forms can submit without a real server. signIn.email /
// signUp.email return the library's FAILURE shape ({ error }) so each form sets its inline error
// and the per-control describedby wires up.
const signInEmail = vi.fn();
const signInSocial = vi.fn();
const signUpEmail = vi.fn();
const verifyTotp = vi.fn();
const verifyBackupCode = vi.fn();
vi.mock("./authClient", () => ({
  authClient: {
    signIn: {
      email: (...args: unknown[]) => signInEmail(...args),
      oauth2: vi.fn(),
      social: (...args: unknown[]) => signInSocial(...args),
    },
    signUp: { email: (...args: unknown[]) => signUpEmail(...args) },
    twoFactor: {
      verifyTotp: (...args: unknown[]) => verifyTotp(...args),
      verifyBackupCode: (...args: unknown[]) => verifyBackupCode(...args),
    },
  },
}));

import { LoginScreen } from "./LoginScreen";
import { m } from "@/i18n";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  signInEmail.mockReset();
  signInSocial.mockReset();
  signUpEmail.mockReset();
  verifyTotp.mockReset();
  verifyBackupCode.mockReset();
});

describe("LoginScreen — external callback failures", () => {
  it("sets a descriptive title while rendering outside the app shell", () => {
    document.title = "Schedule · CapacityLens";

    render(<LoginScreen authMode="password" onSignedIn={vi.fn()} />);

    expect(document.title).toBe("Sign in · CapacityLens");
  });

  it("shows stable retry guidance and removes provider-controlled query values", async () => {
    window.history.replaceState(
      {},
      "",
      "/?externalSignInError=1&error=access_denied&error_description=provider-secret",
    );
    render(
      <LoginScreen
        authMode="sso"
        providers={[{ id: "sso", label: "Single sign-on", kind: "oidc", experimental: false }]}
        onSignedIn={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Single sign-on was not completed. Try again or contact your administrator.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("provider-secret");
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it.each([
    ["OIDC_IDENTITY_VERIFICATION_FAILED", m.login_sso_verification_failed()],
    ["account_link_conflict", m.login_sso_account_link_conflict()],
  ])("maps the application-owned callback code %s to actionable copy", async (code, expected) => {
    window.history.replaceState({}, "", `/?externalSignInError=1&error=${code}`);
    render(
      <LoginScreen
        authMode="sso"
        providers={[{ id: "sso", label: "Single sign-on", kind: "oidc", experimental: false }]}
        onSignedIn={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(expected);
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("supplies a marked failure return to a named social provider", async () => {
    signInSocial.mockResolvedValue({ data: {}, error: null });
    window.history.replaceState({}, "", "/invite/token?source=mail");
    render(
      <LoginScreen
        authMode="sso"
        providers={[{ id: "google", label: "Google", kind: "social", experimental: true }]}
        onSignedIn={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    await waitFor(() =>
      expect(signInSocial).toHaveBeenCalledWith({
        provider: "google",
        callbackURL: "http://localhost:3000/invite/token?source=mail",
        errorCallbackURL: "http://localhost:3000/invite/token?source=mail&externalSignInError=1",
      }),
    );
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Single sign-on was not completed. Try again or contact your administrator.",
    );
  });
});

describe("LoginScreen — multi-factor challenge", () => {
  async function enterTotpChallenge(onSignedIn = vi.fn()) {
    signInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
    render(<LoginScreen authMode="password" onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByLabelText("Authentication code");
    return onSignedIn;
  }

  it("does not enter the app until the authenticator code succeeds", async () => {
    signInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
    verifyTotp.mockResolvedValue({ data: { status: true }, error: null });
    const onSignedIn = vi.fn();
    render(<LoginScreen authMode="password" onSignedIn={onSignedIn} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByLabelText("Authentication code")).toHaveAttribute("autocomplete", "one-time-code");
    expect(onSignedIn).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("mfa-code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("mfa-submit"));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(verifyTotp).toHaveBeenCalledWith({ code: "123456", trustDevice: false });
  });

  it("hides external providers while a password second-factor challenge is pending", async () => {
    signInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
    render(
      <LoginScreen
        authMode="password"
        providers={[{ id: "sso", label: "Company SSO", kind: "oidc", experimental: false }]}
        onSignedIn={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Continue with Company SSO" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByLabelText("Authentication code")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Company SSO" })).not.toBeInTheDocument();
  });

  it("supports a recovery code without marking the browser as trusted", async () => {
    signInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
    verifyBackupCode.mockResolvedValue({ data: { status: true }, error: null });
    const onSignedIn = vi.fn();
    render(<LoginScreen authMode="password" onSignedIn={onSignedIn} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByLabelText("Authentication code");
    fireEvent.click(screen.getByRole("button", { name: "Use a recovery code" }));
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "recover-me" } });
    fireEvent.click(screen.getByTestId("mfa-submit"));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(verifyBackupCode).toHaveBeenCalledWith({ code: "recover-me", trustDevice: false });
  });

  it("keeps the code field open and associated with a rejected authenticator code", async () => {
    verifyTotp.mockResolvedValue({ error: { message: "Authentication code is incorrect." } });
    const onSignedIn = await enterTotpChallenge();

    const code = screen.getByTestId("mfa-code");
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("mfa-submit"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Authentication code is incorrect.");
    expect(code).toHaveAttribute("aria-describedby", alert.id);
    expect(code).toBeInTheDocument();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("surfaces a network error and clears busy when authenticator verification throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    verifyTotp.mockRejectedValue(new TypeError("offline"));
    await enterTotpChallenge();

    fireEvent.change(screen.getByTestId("mfa-code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("mfa-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_network_error());
    expect(screen.getByTestId("mfa-submit")).toBeEnabled();
  });
});

describe("LoginScreen — per-control error cues (WCAG 3.3.1)", () => {
  it("surfaces a network error and re-enables sign in when the request throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    signInEmail.mockRejectedValue(new TypeError("offline"));
    render(<LoginScreen authMode="password" onSignedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_network_error());
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("uses the generic fallback when password sign-in fails without a message", async () => {
    signInEmail.mockResolvedValue({ data: null, error: {} });
    render(<LoginScreen authMode="password" onSignedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_failed());
  });

  it("normalizes a pasted sign-in email before authenticating", async () => {
    signInEmail.mockResolvedValue({ data: {}, error: null });
    render(<LoginScreen authMode="password" onSignedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "  Person@Example.COM  " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(signInEmail).toHaveBeenCalledWith({
        email: "person@example.com",
        password: "correct-password",
      }),
    );
  });

  it("gives the email/password inputs ids and no aria-describedby before any error", () => {
    render(<LoginScreen authMode="password" onSignedIn={vi.fn()} />);
    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    // Each control carries a stable id so it can point at the shared error.
    expect(email).toHaveAttribute("id");
    expect(password).toHaveAttribute("id");
    // No error yet → no describedby dangling at a non-existent message.
    expect(email).not.toHaveAttribute("aria-describedby");
    expect(password).not.toHaveAttribute("aria-describedby");
  });

  it("points both inputs at the error message via aria-describedby after a failed sign-in", async () => {
    signInEmail.mockResolvedValue({ error: { message: "Invalid email or password." } });
    render(<LoginScreen authMode="password" onSignedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    // The role=alert error renders, and BOTH inputs describe it (re-announced on re-navigation).
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid email or password.");
    const errorId = alert.getAttribute("id");
    expect(errorId).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toHaveAttribute("aria-describedby", errorId);
      expect(screen.getByLabelText("Password")).toHaveAttribute("aria-describedby", errorId);
    });
  });
});

// First-run owner setup: needsSetup (server-reported: password mode + zero users) swaps the
// sign-in form for a create-the-owner-account form; success proceeds exactly like a sign-in.
describe("LoginScreen — first-run owner setup (needsSetup)", () => {
  function fillOwnerSetup({
    name = "Owner",
    password = "a-strong-password",
  }: { name?: string; password?: string } = {}) {
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@x.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  }

  it("renders the owner-setup form instead of sign-in when needsSetup", () => {
    render(<LoginScreen authMode="password" needsSetup onSignedIn={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Create the owner account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Setup token")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create owner account" })).toBeInTheDocument();
    // The ordinary sign-in affordances are replaced, not stacked.
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("keeps configured external bootstrap providers reachable during owner setup", () => {
    render(
      <LoginScreen
        authMode="password"
        needsSetup
        providers={[{ id: "sso", label: "Company SSO", kind: "oidc", experimental: true }]}
        onSignedIn={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Create owner account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Company SSO" })).toBeInTheDocument();
  });

  it("renders the ordinary sign-in form when needsSetup is absent (fail-closed default)", () => {
    render(<LoginScreen authMode="password" onSignedIn={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("submits name/email/password through signUp.email and calls onSignedIn on success", async () => {
    signUpEmail.mockResolvedValue({ data: {}, error: null });
    const onSignedIn = vi.fn();
    render(<LoginScreen authMode="password" needsSetup onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Owner" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@x.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-strong-password" } });
    fireEvent.change(screen.getByLabelText("Setup token"), { target: { value: "operator-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Create owner account" }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(signUpEmail).toHaveBeenCalledWith({
      email: "owner@x.test",
      password: "a-strong-password",
      name: "Owner",
      fetchOptions: { headers: { "x-capacitylens-setup-token": "operator-secret" } },
    });
  });

  it("rejects a blank owner name without submitting", async () => {
    render(<LoginScreen authMode="password" needsSetup onSignedIn={vi.fn()} />);
    fillOwnerSetup({ name: "   " });

    fireEvent.click(screen.getByRole("button", { name: "Create owner account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.identity_err_name());
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("rejects a short owner password without submitting", async () => {
    render(<LoginScreen authMode="password" needsSetup onSignedIn={vi.fn()} />);
    fillOwnerSetup({ password: "short" });

    fireEvent.click(screen.getByRole("button", { name: "Create owner account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.identity_err_password({ min: 15, max: 128 }));
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("surfaces a network error and clears busy when owner signup throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    signUpEmail.mockRejectedValue(new TypeError("offline"));
    render(<LoginScreen authMode="password" needsSetup onSignedIn={vi.fn()} />);
    fillOwnerSetup();

    fireEvent.click(screen.getByRole("button", { name: "Create owner account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_network_error());
    expect(screen.getByRole("button", { name: "Create owner account" })).toBeEnabled();
  });

  it("uses the setup fallback when owner signup fails without a message", async () => {
    signUpEmail.mockResolvedValue({ data: null, error: {} });
    render(<LoginScreen authMode="password" needsSetup onSignedIn={vi.fn()} />);
    fillOwnerSetup();

    fireEvent.click(screen.getByRole("button", { name: "Create owner account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_setup_failed());
    expect(screen.getByRole("button", { name: "Create owner account" })).toBeEnabled();
  });

  it("rejects an owner-setup email containing disallowed characters", async () => {
    // Regression: the inline check used to only compare UTF-16 .length against MAX_EMAIL_LENGTH
    // and never screened for disallowed characters, so an emoji/zero-width address that stayed
    // under the length cap slipped past client-side validation. isAccountEmail() rejects it.
    const onSignedIn = vi.fn();
    render(<LoginScreen authMode="password" needsSetup onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Owner" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a​🙂@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-strong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Create owner account" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(m.identity_err_email());
    expect(signUpEmail).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("surfaces a sign-up failure inline and describes every field by it (same WCAG contract as sign-in)", async () => {
    signUpEmail.mockResolvedValue({ error: { message: "Password too short" } });
    const onSignedIn = vi.fn();
    render(<LoginScreen authMode="password" needsSetup onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Owner" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@x.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-strong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Create owner account" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Password too short");
    expect(onSignedIn).not.toHaveBeenCalled();
    const errorId = alert.getAttribute("id");
    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveAttribute("aria-describedby", errorId);
      expect(screen.getByLabelText("Email")).toHaveAttribute("aria-describedby", errorId);
      expect(screen.getByLabelText("Password")).toHaveAttribute("aria-describedby", errorId);
      expect(screen.getByLabelText("Setup token")).toHaveAttribute("aria-describedby", errorId);
    });
    // The button recovers (busy reset) so the user can retry after fixing the input.
    expect(screen.getByRole("button", { name: "Create owner account" })).toBeEnabled();
  });

  it("drops out of setup into the ordinary sign-in form when another operator wins the setup race", async () => {
    // Better Auth's live per-request gate (server/src/auth.ts) refuses a SECOND sign-up with this
    // exact typed code once a user exists — the shape a losing second tab/operator would see.
    signUpEmail.mockResolvedValue({
      error: { message: "Email and password sign up is not enabled", code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" },
    });
    const onSignedIn = vi.fn();
    render(<LoginScreen authMode="password" needsSetup onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Owner" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@x.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-strong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Create owner account" }));

    // The dead end is fixed: the screen switches to the ordinary sign-in form...
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Someone has already set this workspace up — sign in below.");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    });
    // ...the create-owner fields are gone, replaced by the sign-in ones...
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    // ...and the explanatory message is still visible so the user understands why.
    expect(screen.getByRole("alert")).toHaveTextContent("Someone has already set this workspace up — sign in below.");
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});

describe("LoginScreen — provider failures", () => {
  const provider = { id: "google", label: "Google", kind: "social", experimental: true } as const;

  it.each([
    [{ message: "Provider refused the request." }, "Provider refused the request."],
    [{}, m.login_failed()],
  ])("surfaces a provider failure and re-enables controls", async (error, expected) => {
    signInSocial.mockResolvedValue({ data: null, error });
    render(<LoginScreen authMode="sso" providers={[provider]} onSignedIn={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });

  it("surfaces a network error and clears busy when provider sign-in throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    signInSocial.mockRejectedValue(new TypeError("offline"));
    render(<LoginScreen authMode="sso" providers={[provider]} onSignedIn={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_network_error());
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });
});

describe("LoginScreen — degraded 401 body notice", () => {
  it("shows the non-terminal advisory above the form when degraded is true", () => {
    render(<LoginScreen authMode="password" degraded onSignedIn={vi.fn()} />);
    expect(screen.getByText(/sign-in configuration could not be loaded/i)).toBeInTheDocument();
    // Still a fully usable password form underneath the advisory — never a dead end.
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("renders no advisory by default (a well-formed body)", () => {
    render(<LoginScreen authMode="password" onSignedIn={vi.fn()} />);
    expect(screen.queryByText(/sign-in configuration could not be loaded/i)).not.toBeInTheDocument();
  });
});

describe("LoginScreen — unsaved session-expiry notice", () => {
  it("surfaces the captured write loss without blocking sign-in", () => {
    render(<LoginScreen authMode="password" hadUnsavedChanges onSignedIn={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be saved before your session expired/i);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("does not claim loss for an ordinary signed-out boot", () => {
    render(<LoginScreen authMode="password" onSignedIn={vi.fn()} />);
    expect(screen.queryByText(/could not be saved before your session expired/i)).not.toBeInTheDocument();
  });
});
