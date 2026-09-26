import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
import { normalizeSetupToken } from "./useOwnerSetup";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  signInEmail.mockReset();
  signInSocial.mockReset();
  signUpEmail.mockReset();
  verifyTotp.mockReset();
  verifyBackupCode.mockReset();
});

function setsDescriptiveTitleOutsideAppShell() {
  document.title = "Schedule · CapacityLens";

  render(<LoginScreen authMode="password-only" onSignedIn={vi.fn()} />);

  expect(document.title).toBe("Sign in · CapacityLens");
}

async function showsStableRetryGuidanceAndRemovesProviderQueryValues() {
  window.history.replaceState({}, "", "/?externalSignInError=1&error=access_denied&error_description=provider-secret");
  render(
    <LoginScreen
      authMode="sso-only"
      providers={[{ id: "microsoft", label: "Microsoft", kind: "social", experimental: false }]}
      onSignedIn={vi.fn()}
    />,
  );

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Single sign-on was not completed. Try again or contact your administrator.",
  );
  expect(screen.getByRole("alert")).not.toHaveTextContent("provider-secret");
  await waitFor(() => expect(window.location.search).toBe(""));
}

async function mapsApplicationOwnedCallbackCodeToActionableCopy(code: string, expected: string) {
  window.history.replaceState({}, "", `/?externalSignInError=1&error=${code}`);
  render(
    <LoginScreen
      authMode="sso-only"
      providers={[{ id: "microsoft", label: "Microsoft", kind: "social", experimental: false }]}
      onSignedIn={vi.fn()}
    />,
  );

  expect(screen.getByRole("alert")).toHaveTextContent(expected);
  await waitFor(() => expect(window.location.search).toBe(""));
}

async function keepsProviderRedirectPendingAfterDispatchingNamedSocialProvider() {
  signInSocial.mockResolvedValue({ data: {}, error: null });
  window.history.replaceState({}, "", "/invite/token?source=mail");
  render(
    <LoginScreen
      authMode="sso-only"
      providers={[{ id: "google", label: "Google", kind: "social", experimental: true }]}
      onSignedIn={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));

  await waitFor(() =>
    expect(signInSocial).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "http://localhost:3000/invite/token?source=mail",
      errorCallbackURL: "http://localhost:3000/invite/token?source=mail&externalSignInError=1",
    }),
  );
  expect(screen.getByRole("status")).toHaveTextContent("Redirecting to Google…");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeDisabled();
}

describe("LoginScreen — external callback failures", () => {
  it("sets a descriptive title while rendering outside the app shell", setsDescriptiveTitleOutsideAppShell);

  it(
    "shows stable retry guidance and removes provider-controlled query values",
    showsStableRetryGuidanceAndRemovesProviderQueryValues,
  );

  it.each([
    ["OIDC_IDENTITY_VERIFICATION_FAILED", m.login_sso_failed()],
    ["account_link_conflict", m.login_sso_account_link_conflict()],
  ])(
    "maps the application-owned callback code %s to actionable copy",
    mapsApplicationOwnedCallbackCodeToActionableCopy,
  );

  it(
    "keeps the provider redirect pending after dispatching a named social provider",
    keepsProviderRedirectPendingAfterDispatchingNamedSocialProvider,
  );
});

describe("LoginScreen — mixed-mode Google hierarchy", () => {
  const google = { id: "google", label: "Google", kind: "social", experimental: true } as const;
  const github = { id: "github", label: "GitHub", kind: "social", experimental: true } as const;

  it("puts Google before the password fallback with explicit wording", () => {
    render(<LoginScreen authMode="password-and-sso" providers={[google]} onSignedIn={vi.fn()} />);

    const googleButton = screen.getByRole("button", { name: "Sign in with Google" });
    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    const signIn = screen.getByRole("button", { name: "Sign in" });

    expect(googleButton.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(email.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(password.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(googleButton).toHaveClass("mt-5", "mb-4");
    expect(screen.getByText("or use your password").parentElement).toHaveClass("my-4");
  });
  it("starts keyboard focus on Google, then reaches the password email field", async () => {
    const user = userEvent.setup();
    render(<LoginScreen authMode="password-and-sso" providers={[google]} onSignedIn={vi.fn()} />);

    const googleButton = screen.getByRole("button", { name: "Sign in with Google" });
    const email = screen.getByLabelText("Email");
    expect(email).not.toHaveFocus();

    await user.tab();
    expect(googleButton).toHaveFocus();
    await user.tab();
    expect(email).toHaveFocus();
  });

  it("keeps password email autofocus when Google is not configured", () => {
    render(<LoginScreen authMode="password-only" onSignedIn={vi.fn()} />);

    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("keeps the owner name autofocus during first-owner setup", () => {
    render(<LoginScreen authMode="password-and-sso" needsSetup providers={[google]} onSignedIn={vi.fn()} />);

    expect(screen.getByLabelText("name")).toHaveFocus();
  });

  it("lets the fallback separator rails share the remaining row width", () => {
    render(<LoginScreen authMode="password-and-sso" providers={[google]} onSignedIn={vi.fn()} />);

    const rails = screen.getAllByRole("none").filter((element) => element.getAttribute("data-slot") === "separator");
    expect(rails).toHaveLength(2);
    for (const rail of rails) {
      expect(rail).toHaveClass("min-w-0", "flex-1", "shrink", "data-[orientation=horizontal]:w-auto");
    }
  });

  it("keeps experimental GitHub after the password fallback", () => {
    render(<LoginScreen authMode="password-and-sso" providers={[google, github]} onSignedIn={vi.fn()} />);

    const googleButton = screen.getByRole("button", { name: "Sign in with Google" });
    const signIn = screen.getByRole("button", { name: "Sign in" });
    const companyButton = screen.getByRole("button", { name: "Continue with GitHub" });

    expect(googleButton.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(signIn.compareDocumentPosition(companyButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not promote providers in SSO-only mode", () => {
    render(<LoginScreen authMode="sso-only" providers={[google]} onSignedIn={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByText("or use your password")).not.toBeInTheDocument();
  });

  it("keeps password-first behavior when only GitHub is configured", () => {
    render(<LoginScreen authMode="password-and-sso" providers={[github]} onSignedIn={vi.fn()} />);

    const email = screen.getByLabelText("Email");
    const companyButton = screen.getByRole("button", { name: "Continue with GitHub" });
    expect(email.compareDocumentPosition(companyButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("or use your password")).not.toBeInTheDocument();
  });

  it("keeps first-owner setup ahead of the promoted provider", () => {
    render(<LoginScreen authMode="password-and-sso" needsSetup providers={[google]} onSignedIn={vi.fn()} />);

    const name = screen.getByLabelText("name");
    const googleButton = screen.getByRole("button", { name: "Sign in with Google" });
    expect(name.compareDocumentPosition(googleButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("or use your password")).not.toBeInTheDocument();
  });

  it("hides the promoted action and fallback while password MFA is pending", async () => {
    signInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
    render(<LoginScreen authMode="password-and-sso" providers={[google]} onSignedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const code = await screen.findByLabelText("Authentication code");
    expect(code).toBeInTheDocument();
    expect(code).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
    expect(screen.queryByText("or use your password")).not.toBeInTheDocument();
  });

  it("keeps password errors associated with both controls after Google promotion", async () => {
    signInEmail.mockResolvedValue({ error: { message: "Invalid email or password." } });
    render(<LoginScreen authMode="password-and-sso" providers={[google]} onSignedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    const errorId = alert.getAttribute("id");
    expect(errorId).toBeTruthy();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-describedby", errorId);
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-describedby", errorId);
  });
});

async function enterTotpChallenge(onSignedIn = vi.fn()) {
  signInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
  render(<LoginScreen authMode="password-only" onSignedIn={onSignedIn} />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByLabelText("Authentication code");
  return onSignedIn;
}

async function completesAuthenticatorChallengeBeforeSigningIn() {
  signInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
  verifyTotp.mockResolvedValue({ data: { status: true }, error: null });
  const onSignedIn = vi.fn();
  render(<LoginScreen authMode="password-only" onSignedIn={onSignedIn} />);

  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByLabelText("Authentication code")).toHaveAttribute("autocomplete", "one-time-code");
  expect(onSignedIn).not.toHaveBeenCalled();

  fireEvent.change(screen.getByTestId("mfa-code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByTestId("mfa-submit"));
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  expect(verifyTotp).toHaveBeenCalledWith({ code: "123456", trustDevice: false });
}

describe("LoginScreen — multi-factor challenge", () => {
  it("does not enter the app until the authenticator code succeeds", completesAuthenticatorChallengeBeforeSigningIn);

  it("hides external providers while a password second-factor challenge is pending", async () => {
    signInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
    render(
      <LoginScreen
        authMode="password-and-sso"
        providers={[{ id: "microsoft", label: "Microsoft", kind: "social", experimental: false }]}
        onSignedIn={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByLabelText("Authentication code")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with Microsoft" })).not.toBeInTheDocument();
  });

  it("supports a recovery code without marking the browser as trusted", async () => {
    signInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
    verifyBackupCode.mockResolvedValue({ data: { status: true }, error: null });
    const onSignedIn = vi.fn();
    render(<LoginScreen authMode="password-only" onSignedIn={onSignedIn} />);

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
    render(<LoginScreen authMode="password-only" onSignedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_network_error());
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("uses the generic fallback when password sign-in fails without a message", async () => {
    signInEmail.mockResolvedValue({ data: null, error: {} });
    render(<LoginScreen authMode="password-only" onSignedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_failed());
  });

  it("normalizes a pasted sign-in email before authenticating", async () => {
    signInEmail.mockResolvedValue({ data: {}, error: null });
    render(<LoginScreen authMode="password-only" onSignedIn={vi.fn()} />);

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
    render(<LoginScreen authMode="password-only" onSignedIn={vi.fn()} />);
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
    render(<LoginScreen authMode="password-only" onSignedIn={vi.fn()} />);

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
function fillOwnerSetup({ name = "Owner", password = "a-strong-password" }: { name?: string; password?: string } = {}) {
  fireEvent.change(screen.getByLabelText("name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("email"), { target: { value: "owner@x.test" } });
  fireEvent.change(screen.getByLabelText("Create a password"), { target: { value: password } });
}

function registerOwnerSetupDisplayTests() {
  it("renders the owner-setup form instead of sign-in when needsSetup", () => {
    render(<LoginScreen authMode="password-only" needsSetup onSignedIn={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Setup the account Owner" })).toBeInTheDocument();
    expect(screen.queryByText(/Create your personal sign-in/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("name")).toBeInTheDocument();
    expect(screen.getByLabelText("email")).toBeInTheDocument();
    expect(screen.getByLabelText("Create a password")).not.toHaveAccessibleDescription("Use 15–128 characters.");
    expect(screen.getByLabelText("Owner setup token")).toHaveAttribute("placeholder", "Paste the setup token");
    expect(screen.getByLabelText("Owner setup token")).toHaveAccessibleDescription(
      "Paste the value of SMALLSASS_ACCOUNT_SETUP_TOKEN from the .env file, on the server. Ask the person who installed it for you. You cannot proceed without it.",
    );
    expect(screen.queryByText(/server has no users/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create my sign-in" })).toBeInTheDocument();
    // The ordinary sign-in affordances are replaced, not stacked.
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("keeps configured external bootstrap providers reachable during owner setup", () => {
    render(
      <LoginScreen
        authMode="password-and-sso"
        needsSetup
        providers={[{ id: "microsoft", label: "Microsoft", kind: "social", experimental: false }]}
        onSignedIn={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Create my sign-in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Company login is a separate route. If your installer configured it, choose its button below to create the first Owner without a local password.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the ordinary sign-in form when needsSetup is absent (fail-closed default)", () => {
    render(
      <LoginScreen
        authMode="password-and-sso"
        providers={[{ id: "microsoft", label: "Microsoft", kind: "social", experimental: false }]}
        onSignedIn={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByLabelText("name")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Company login is a separate route. If your installer configured it, choose its button below to create the first Owner without a local password.",
      ),
    ).not.toBeInTheDocument();
  });
}

function registerOwnerSetupSubmissionTests() {
  it("submits name/email/password through signUp.email and calls onSignedIn on success", async () => {
    signUpEmail.mockResolvedValue({ data: {}, error: null });
    const onSignedIn = vi.fn();
    render(<LoginScreen authMode="password-only" needsSetup onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Owner" } });
    fireEvent.change(screen.getByLabelText("email"), { target: { value: "owner@x.test" } });
    fireEvent.change(screen.getByLabelText("Create a password"), { target: { value: "a-strong-password" } });
    fireEvent.change(screen.getByLabelText("Owner setup token"), {
      target: { value: "operator-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create my sign-in" }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(signUpEmail).toHaveBeenCalledWith({
      email: "owner@x.test",
      password: "a-strong-password",
      name: "Owner",
      fetchOptions: { headers: { "x-capacitylens-setup-token": "operator-secret" } },
    });
  });

  it("rejects a blank owner name without submitting", async () => {
    render(<LoginScreen authMode="password-only" needsSetup onSignedIn={vi.fn()} />);
    fillOwnerSetup({ name: "   " });

    fireEvent.click(screen.getByRole("button", { name: "Create my sign-in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.identity_err_name());
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("rejects a short owner password without submitting", async () => {
    render(<LoginScreen authMode="password-only" needsSetup onSignedIn={vi.fn()} />);
    fillOwnerSetup({ password: "short" });

    fireEvent.click(screen.getByRole("button", { name: "Create my sign-in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.identity_err_password({ min: 15, max: 128 }));
    expect(signUpEmail).not.toHaveBeenCalled();
  });
}

function registerOwnerSetupTokenTests() {
  it("trims setup-token edge whitespace before constructing the request", async () => {
    signUpEmail.mockResolvedValue({ data: {}, error: null });
    render(<LoginScreen authMode="password-only" needsSetup onSignedIn={vi.fn()} />);
    fillOwnerSetup();
    fireEvent.change(screen.getByLabelText("Owner setup token"), {
      target: { value: "  operator-secret  " },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create my sign-in" }));

    await waitFor(() => expect(signUpEmail).toHaveBeenCalled());
    expect(signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({ fetchOptions: { headers: { "x-capacitylens-setup-token": "operator-secret" } } }),
    );
  });

  it.each([
    ["a zero-width space", "\u200b"],
    ["a word joiner", "\u2060"],
    ["a non-Latin-1 character", "🙂"],
    ["a control character", "\u0000"],
  ])("rejects %s before constructing the request", async (_description, suffix) => {
    const onSignedIn = vi.fn();
    render(<LoginScreen authMode="password-only" needsSetup onSignedIn={onSignedIn} />);
    fillOwnerSetup();
    const token = `operator-secret${suffix}`;
    fireEvent.change(screen.getByLabelText("Owner setup token"), { target: { value: token } });

    fireEvent.click(screen.getByRole("button", { name: "Create my sign-in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_setup_token_invalid());
    expect(signUpEmail).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Owner setup token")).toHaveValue(token);
    expect(screen.getByRole("button", { name: "Create my sign-in" })).toBeEnabled();
  });

  it("trims Unicode edge whitespace from a pasted setup token", async () => {
    signUpEmail.mockResolvedValue({ data: {}, error: null });
    render(<LoginScreen authMode="password-only" needsSetup onSignedIn={vi.fn()} />);
    fillOwnerSetup();
    fireEvent.change(screen.getByLabelText("Owner setup token"), {
      target: { value: "\uFEFF operator-secret\u00A0" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create my sign-in" }));

    await waitFor(() => expect(signUpEmail).toHaveBeenCalled());
    expect(signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({ fetchOptions: { headers: { "x-capacitylens-setup-token": "operator-secret" } } }),
    );
  });

  it.each([
    ["an embedded line feed", "operator-\n-secret"],
    ["an embedded carriage return", "operator-\r-secret"],
  ])("rejects %s in the token normalizer", (_description, token) => {
    expect(normalizeSetupToken(token)).toBeNull();
  });
}

function registerOwnerSetupErrorTests() {
  it("surfaces a network error and clears busy when owner signup throws", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const token = "operator-secret-that-must-not-be-logged";
    signUpEmail.mockRejectedValue(new TypeError(`offline while sending ${token}`));
    render(<LoginScreen authMode="password-only" needsSetup onSignedIn={vi.fn()} />);
    fillOwnerSetup();
    fireEvent.change(screen.getByLabelText("Owner setup token"), { target: { value: token } });

    fireEvent.click(screen.getByRole("button", { name: "Create my sign-in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_network_error());
    expect(screen.getByRole("button", { name: "Create my sign-in" })).toBeEnabled();
    expect(logError).toHaveBeenCalledWith("LoginScreen: owner-setup sign-up request failed");
    const loggedValues = vi
      .mocked(logError)
      .mock.calls.flat()
      .map((value) => String(value))
      .join("\n");
    expect(loggedValues).not.toContain(token);
  });

  it("uses the setup fallback when owner signup fails without a message", async () => {
    signUpEmail.mockResolvedValue({ data: null, error: {} });
    render(<LoginScreen authMode="password-only" needsSetup onSignedIn={vi.fn()} />);
    fillOwnerSetup();

    fireEvent.click(screen.getByRole("button", { name: "Create my sign-in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_setup_failed());
    expect(screen.getByRole("button", { name: "Create my sign-in" })).toBeEnabled();
  });
}

function registerOwnerSetupValidationTests() {
  it("rejects an owner-setup email containing disallowed characters", async () => {
    // Regression: the inline check used to only compare UTF-16 .length against MAX_EMAIL_LENGTH
    // and never screened for disallowed characters, so an emoji/zero-width address that stayed
    // under the length cap slipped past client-side validation. isAccountEmail() rejects it.
    const onSignedIn = vi.fn();
    render(<LoginScreen authMode="password-only" needsSetup onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Owner" } });
    fireEvent.change(screen.getByLabelText("email"), { target: { value: "a​🙂@example.com" } });
    fireEvent.change(screen.getByLabelText("Create a password"), { target: { value: "a-strong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Create my sign-in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(m.identity_err_email());
    expect(signUpEmail).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("surfaces a sign-up failure inline and describes every field by it (same WCAG contract as sign-in)", async () => {
    signUpEmail.mockResolvedValue({ error: { message: "Password too short" } });
    const onSignedIn = vi.fn();
    render(<LoginScreen authMode="password-only" needsSetup onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Owner" } });
    fireEvent.change(screen.getByLabelText("email"), { target: { value: "owner@x.test" } });
    fireEvent.change(screen.getByLabelText("Create a password"), { target: { value: "a-strong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Create my sign-in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Password too short");
    expect(onSignedIn).not.toHaveBeenCalled();
    const errorId = alert.getAttribute("id");
    await waitFor(() => {
      expect(screen.getByLabelText("name")).toHaveAttribute("aria-describedby", errorId);
      expect(screen.getByLabelText("email")).toHaveAttribute("aria-describedby", errorId);
      expect(screen.getByLabelText("Create a password").getAttribute("aria-describedby")).toContain(errorId);
      expect(screen.getByLabelText("Owner setup token").getAttribute("aria-describedby")).toContain(errorId);
    });
    // The button recovers (busy reset) so the user can retry after fixing the input.
    expect(screen.getByRole("button", { name: "Create my sign-in" })).toBeEnabled();
  });
}

function registerOwnerSetupAccessibilityAndRaceTests() {
  it("drops out of setup into the ordinary sign-in form when another operator wins the setup race", async () => {
    // Better Auth's live per-request gate (server/src/auth.ts) refuses a SECOND sign-up with this
    // exact typed code once a user exists — the shape a losing second tab/operator would see.
    signUpEmail.mockResolvedValue({
      error: { message: "Email and password sign up is not enabled", code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" },
    });
    const onSignedIn = vi.fn();
    render(<LoginScreen authMode="password-only" needsSetup onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Owner" } });
    fireEvent.change(screen.getByLabelText("email"), { target: { value: "owner@x.test" } });
    fireEvent.change(screen.getByLabelText("Create a password"), { target: { value: "a-strong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Create my sign-in" }));

    // The dead end is fixed: the screen switches to the ordinary sign-in form...
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "First-owner setup for this installation is already complete — use the ordinary sign-in form below.",
    );
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    });
    // ...the create-owner fields are gone, replaced by the sign-in ones...
    expect(screen.queryByLabelText("name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    // ...and the explanatory message is still visible so the user understands why.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "First-owner setup for this installation is already complete — use the ordinary sign-in form below.",
    );
    expect(onSignedIn).not.toHaveBeenCalled();
  });
}

describe("LoginScreen — first-run owner setup (needsSetup)", () => {
  registerOwnerSetupDisplayTests();
  registerOwnerSetupSubmissionTests();
  registerOwnerSetupTokenTests();
  registerOwnerSetupErrorTests();
  registerOwnerSetupValidationTests();
  registerOwnerSetupAccessibilityAndRaceTests();
});

describe("LoginScreen — provider failures", () => {
  const provider = { id: "google", label: "Google", kind: "social", experimental: true } as const;
  type ProviderResponse = { data: Record<string, never>; error: null };

  it.each([
    [{ message: "Provider refused the request." }, "Provider refused the request."],
    [{}, m.login_failed()],
  ])("surfaces a provider failure and re-enables controls", async (error, expected) => {
    signInSocial.mockResolvedValue({ data: null, error });
    render(<LoginScreen authMode="sso-only" providers={[provider]} onSignedIn={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeEnabled();
  });

  it.each(["password-and-sso", "sso-only"] as const)(
    "announces a successful provider redirect instead of showing a failure in %s mode",
    async (authMode) => {
      let resolveProvider!: (value: ProviderResponse) => void;
      const providerResponse = new Promise<ProviderResponse>((resolve) => (resolveProvider = resolve));
      signInSocial.mockReturnValue(providerResponse);
      render(<LoginScreen authMode={authMode} providers={[provider]} onSignedIn={vi.fn()} />);
      const button = screen.getByRole("button", { name: "Sign in with Google" });
      fireEvent.click(button);

      expect(await screen.findByRole("status")).toHaveTextContent("Redirecting to Google…");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(button).toBeDisabled();
      resolveProvider({ data: {}, error: null });
      await providerResponse;
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent("Redirecting to Google…");
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(button).toBeDisabled();
      });
    },
  );

  it("clears a prior provider error before announcing the redirect", async () => {
    signInSocial.mockResolvedValueOnce({ data: null, error: { message: "Provider refused the request." } });
    signInSocial.mockResolvedValueOnce({ data: {}, error: null });
    render(<LoginScreen authMode="sso-only" providers={[provider]} onSignedIn={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Sign in with Google" });
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Provider refused the request.");
    expect(button).toBeEnabled();

    fireEvent.click(button);
    expect(await screen.findByRole("status")).toHaveTextContent("Redirecting to Google…");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces a network error and clears busy when provider sign-in throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    signInSocial.mockRejectedValue(new TypeError("offline"));
    render(<LoginScreen authMode="sso-only" providers={[provider]} onSignedIn={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_network_error());
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeEnabled();
  });
});

describe("LoginScreen — degraded 401 body notice", () => {
  it("shows the non-terminal advisory above the form when degraded is true", () => {
    render(<LoginScreen authMode="password-only" degraded onSignedIn={vi.fn()} />);
    expect(screen.getByText(/sign-in configuration could not be loaded/i)).toBeInTheDocument();
    // Still a fully usable password form underneath the advisory — never a dead end.
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("renders no advisory by default (a well-formed body)", () => {
    render(<LoginScreen authMode="password-only" onSignedIn={vi.fn()} />);
    expect(screen.queryByText(/sign-in configuration could not be loaded/i)).not.toBeInTheDocument();
  });
});

describe("LoginScreen — unsaved session-expiry notice", () => {
  it("surfaces the captured write loss without blocking sign-in", () => {
    render(<LoginScreen authMode="password-only" hadUnsavedChanges onSignedIn={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be saved before your session expired/i);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("does not claim loss for an ordinary signed-out boot", () => {
    render(<LoginScreen authMode="password-only" onSignedIn={vi.fn()} />);
    expect(screen.queryByText(/could not be saved before your session expired/i)).not.toBeInTheDocument();
  });
});
