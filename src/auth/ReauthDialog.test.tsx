import { afterEach, describe, expect, it, vi } from "vitest";
import { useSyncExternalStore } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReauthDialog } from "./ReauthDialog";
import { reauthPending, requestReauth, resolveReauth, subscribeReauth } from "./reauthCoordinator";
import type { AuthProviderInfo, AuthUser } from "./authContext";

// DEFECT B — the "Confirm it's you" step-up dialog. Better Auth's client is mocked so we can drive a
// success / failure without a network. The dialog resolves the coordinator on success (which the
// wrapper turns into a retry) and shows the failure INLINE without closing.

const signInEmail = vi.fn();
const signInOauth2 = vi.fn();
const signInSocial = vi.fn();
const verifyTotp = vi.fn();
const verifyBackupCode = vi.fn();
vi.mock("./authClient", () => ({
  authClient: {
    signIn: {
      email: (...args: unknown[]) => signInEmail(...args),
      oauth2: (...args: unknown[]) => signInOauth2(...args),
      social: (...args: unknown[]) => signInSocial(...args),
    },
    twoFactor: {
      verifyTotp: (...args: unknown[]) => verifyTotp(...args),
      verifyBackupCode: (...args: unknown[]) => verifyBackupCode(...args),
    },
  },
}));

// The real bridge (ReauthMount in AuthProvider) is this exact shape: show the dialog only while a
// step-up is pending. Rendering it here lets us assert the dialog opens on requestReauth() and
// UNMOUNTS (closes) when the coordinator resolves.
function Harness({
  user,
  providers = [],
  authMode = "password",
  reauthMethod,
  reauthProviderId,
}: {
  user: AuthUser | null;
  providers?: AuthProviderInfo[];
  authMode?: "password" | "sso";
  reauthMethod?: "password" | "provider";
  reauthProviderId?: string | null;
}) {
  const pending = useSyncExternalStore(subscribeReauth, reauthPending);
  if (!pending) return <div>no-dialog</div>;
  return (
    <ReauthDialog
      authMode={authMode}
      user={user}
      providers={providers}
      reauthMethod={reauthMethod}
      reauthProviderId={reauthProviderId}
    />
  );
}

afterEach(() => {
  if (reauthPending()) resolveReauth(false);
  signInEmail.mockReset();
  signInOauth2.mockReset();
  signInSocial.mockReset();
  verifyTotp.mockReset();
  verifyBackupCode.mockReset();
  window.history.replaceState({}, "", "/");
});

const user: AuthUser = { id: "u1", email: "owner@acme.test" };

describe("ReauthDialog (SESSION_NOT_FRESH step-up)", () => {
  it("a pending re-auth request triggers the dialog", async () => {
    render(<Harness user={user} />);
    expect(screen.getByText("no-dialog")).toBeInTheDocument();
    resolveReauthLater();
    expect(await screen.findByRole("heading", { name: "Confirm it's you" })).toBeInTheDocument();
    expect(screen.getByTestId("reauth-password")).toBeInTheDocument();
  });

  it("a successful re-auth closes the dialog and resolves the pending request as reauthenticated", async () => {
    signInEmail.mockResolvedValue({ data: {}, error: null });
    render(<Harness user={user} />);
    const outcome = requestReauth();
    let settled: boolean | null = null;
    void outcome.then((v) => {
      settled = v;
    });
    await screen.findByRole("heading", { name: "Confirm it's you" });

    fireEvent.change(screen.getByTestId("reauth-password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(signInEmail).toHaveBeenCalledWith({ email: "owner@acme.test", password: "correct horse" }),
    );
    // Dialog gone (pending cleared) and the coordinator resolved TRUE (the wrapper will retry).
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Confirm it's you" })).not.toBeInTheDocument());
    await waitFor(() => expect(settled).toBe(true));
    expect(reauthPending()).toBe(false);
  });

  it("cannot cancel while password verification is in flight", async () => {
    let release!: (value: { data: object; error: null }) => void;
    signInEmail.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    render(<Harness user={user} />);
    const outcome = requestReauth();
    await screen.findByRole("heading", { name: "Confirm it's you" });
    fireEvent.change(screen.getByTestId("reauth-password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(signInEmail).toHaveBeenCalledOnce());

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(reauthPending()).toBe(true);
    expect(screen.getByRole("heading", { name: "Confirm it's you" })).toBeInTheDocument();

    release({ data: {}, error: null });
    await expect(outcome).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Confirm it's you" })).toBeNull());
  });

  it("a wrong password surfaces the error INSIDE the dialog and leaves it open", async () => {
    signInEmail.mockResolvedValue({ data: null, error: { message: "Invalid email or password." } });
    render(<Harness user={user} />);
    void requestReauth();
    await screen.findByRole("heading", { name: "Confirm it's you" });

    const password = screen.getByTestId("reauth-password");
    expect(password).not.toHaveAttribute("aria-invalid");
    expect(password).not.toHaveAttribute("aria-describedby");
    fireEvent.change(password, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid email or password.");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute("aria-describedby", alert.id);
    // Still open, still pending — the user can try again.
    expect(screen.getByRole("heading", { name: "Confirm it's you" })).toBeInTheDocument();
    expect(reauthPending()).toBe(true);
  });

  it("associates a rejected second factor with its authentication-code input", async () => {
    signInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
    verifyTotp.mockResolvedValue({ data: null, error: { message: "Authentication code is incorrect." } });
    render(<Harness user={user} />);
    void requestReauth();
    await screen.findByRole("heading", { name: "Confirm it's you" });
    fireEvent.change(screen.getByTestId("reauth-password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    const code = await screen.findByTestId("reauth-2fa-code");
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("reauth-2fa-submit"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Authentication code is incorrect.");
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(code).toHaveAttribute("aria-describedby", alert.id);
  });

  it("uses a recovery code for in-place step-up without trusting the browser", async () => {
    signInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
    verifyBackupCode.mockResolvedValue({ data: { status: true }, error: null });
    render(<Harness user={user} />);
    const outcome = requestReauth();
    await screen.findByRole("heading", { name: "Confirm it's you" });
    fireEvent.change(screen.getByTestId("reauth-password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    const authenticatorCode = await screen.findByLabelText("Authentication code");
    fireEvent.click(screen.getByRole("button", { name: "Use a recovery code" }));
    expect(authenticatorCode).toHaveValue("");
    const recoveryCode = screen.getByLabelText("Recovery code");
    expect(recoveryCode).toHaveAttribute("inputmode", "text");
    fireEvent.change(recoveryCode, { target: { value: "backup-code-1" } });
    fireEvent.click(screen.getByTestId("reauth-2fa-submit"));

    await expect(outcome).resolves.toBe(true);
    expect(verifyBackupCode).toHaveBeenCalledWith({ code: "backup-code-1", trustDevice: false });
    expect(verifyTotp).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Confirm it's you" })).not.toBeInTheDocument();
  });

  it("preserves the product route and supplies a marked OIDC failure return", async () => {
    signInOauth2.mockResolvedValue({ data: {}, error: null });
    window.history.replaceState({}, "", "/team?tab=access");
    render(
      <Harness
        authMode="sso"
        user={user}
        providers={[{ id: "sso", label: "Single sign-on", kind: "oidc", experimental: false }]}
      />,
    );
    void requestReauth();
    await screen.findByRole("heading", { name: "Confirm it's you" });

    fireEvent.click(screen.getByRole("button", { name: "Continue with Single sign-on" }));

    await waitFor(() =>
      expect(signInOauth2).toHaveBeenCalledWith({
        providerId: "sso",
        callbackURL: "http://localhost:3000/team?tab=access",
        errorCallbackURL: "http://localhost:3000/team?tab=access&externalSignInError=1",
      }),
    );
  });

  it("uses the session's OIDC provider for a federated-only principal in mixed mode", async () => {
    signInOauth2.mockResolvedValue({ data: {}, error: null });
    render(
      <Harness
        authMode="password"
        reauthMethod="provider"
        reauthProviderId="workforce"
        user={user}
        providers={[
          { id: "workforce", label: "Workforce SSO", kind: "oidc", experimental: false },
          { id: "github", label: "GitHub", kind: "social", experimental: true },
        ]}
      />,
    );
    void requestReauth();
    await screen.findByRole("heading", { name: "Confirm it's you" });

    expect(screen.queryByTestId("reauth-password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with GitHub" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue with Workforce SSO" }));

    await waitFor(() =>
      expect(signInOauth2).toHaveBeenCalledWith(expect.objectContaining({ providerId: "workforce" })),
    );
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("preserves the product route and supplies a marked social-provider failure return", async () => {
    signInSocial.mockResolvedValue({ data: {}, error: null });
    window.history.replaceState({}, "", "/team?tab=access");
    render(
      <Harness
        authMode="sso"
        user={user}
        providers={[{ id: "github", label: "GitHub", kind: "social", experimental: true }]}
      />,
    );
    void requestReauth();
    await screen.findByRole("heading", { name: "Confirm it's you" });

    fireEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));

    await waitFor(() =>
      expect(signInSocial).toHaveBeenCalledWith({
        provider: "github",
        callbackURL: "http://localhost:3000/team?tab=access",
        errorCallbackURL: "http://localhost:3000/team?tab=access&externalSignInError=1",
      }),
    );
  });
});

// Small helper so the "triggers the dialog" test reads cleanly: fire the request without awaiting it.
function resolveReauthLater() {
  void requestReauth();
}
