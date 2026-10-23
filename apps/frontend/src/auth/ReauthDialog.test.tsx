import { afterEach, describe, expect, it, vi } from "vitest";
import { useSyncExternalStore } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReauthDialog } from "./ReauthDialog";
import { isReauthPending, requestReauth, completeReauth, subscribeReauth } from "./reauthCoordinator";
import type { ReauthAction, ReauthResult } from "./reauthCoordinator";
import type { AuthUser } from "./authContext";
import { m } from "@/i18n";

// The dialog stays open on failed authentication and resolves the shared waiting request only after authentication succeeds or is cancelled.

const signInEmail = vi.fn();
vi.mock("./authClient", () => ({
  authClient: {
    signIn: {
      email: (...args: unknown[]) => signInEmail(...args),
    },
  },
}));

// The real bridge (ReauthMount in AuthProvider) is this exact shape: show the dialog only while a
// step-up is pending. Rendering it here lets us assert the dialog opens on requestReauth() and
// unmounts (closes) when the coordinator resolves.
function Harness({ user, action }: { user: AuthUser | null; action?: ReauthAction | null }) {
  const pending = useSyncExternalStore(subscribeReauth, isReauthPending);
  if (!pending) return <div>no-dialog</div>;
  return <ReauthDialog user={user} {...(action !== undefined ? { action } : {})} />;
}

afterEach(() => {
  if (isReauthPending()) completeReauth({ reauthenticated: false });
  signInEmail.mockReset();
  window.history.replaceState({}, "", "/");
});

const user: AuthUser = { id: "u1", email: "owner@acme.test" };

describe("ReauthDialog password step-up", () => {
  it("a pending re-auth request triggers the dialog", async () => {
    render(<Harness user={user} />);
    expect(screen.getByText("no-dialog")).toBeInTheDocument();
    resolveReauthLater();
    expect(await screen.findByRole("heading", { name: "Confirm it's you" })).toBeInTheDocument();
    expect(screen.getByTestId("reauth-password")).toBeInTheDocument();
  });

  it("names the action that initiated the confirmation", async () => {
    render(<Harness user={user} action="remove-member" />);
    void requestReauth("remove-member");

    expect(await screen.findByRole("heading", { name: "Confirm it's you — Remove member" })).toBeInTheDocument();
  });

  it("a successful re-auth closes the dialog and resolves the pending request as reauthenticated", async () => {
    signInEmail.mockResolvedValue({ data: {}, error: null });
    render(<Harness user={user} />);
    const outcome = requestReauth();
    let settled: ReauthResult | null = null;
    void outcome.then((v) => {
      settled = v;
    });
    await screen.findByRole("heading", { name: "Confirm it's you" });

    fireEvent.change(screen.getByTestId("reauth-password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(signInEmail).toHaveBeenCalledWith({ email: "owner@acme.test", password: "correct horse" }),
    );

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Confirm it's you" })).not.toBeInTheDocument());
    await waitFor(() => expect(settled).toEqual({ kind: "authenticated" }));
    expect(isReauthPending()).toBe(false);
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
    expect(isReauthPending()).toBe(true);
    expect(screen.getByRole("heading", { name: "Confirm it's you" })).toBeInTheDocument();

    release({ data: {}, error: null });
    await expect(outcome).resolves.toEqual({ kind: "authenticated" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Confirm it's you" })).toBeNull());
  });
});

describe("ReauthDialog password rejection", () => {
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

    expect(screen.getByRole("heading", { name: "Confirm it's you" })).toBeInTheDocument();
    expect(isReauthPending()).toBe(true);
  });
});

describe("ReauthDialog current-password size", () => {
  it("rejects oversized passwords without changing or submitting the credential", async () => {
    render(<Harness user={user} />);
    void requestReauth();
    await screen.findByRole("heading", { name: "Confirm it's you" });
    const password = "x".repeat(257);
    fireEvent.change(screen.getByTestId("reauth-password"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(screen.getByTestId("reauth-password")).toHaveValue(password);
    expect(screen.getByRole("alert")).toHaveTextContent(m.reauth_failed());
    expect(signInEmail).not.toHaveBeenCalled();
  });
});

describe("ReauthDialog password failures", () => {
  it("fails locally when password re-auth has no user email", async () => {
    render(<Harness user={null} />);
    void requestReauth();
    await screen.findByRole("heading", { name: "Confirm it's you" });

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.reauth_failed());
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("surfaces a network error and re-enables Confirm when password verification throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    signInEmail.mockRejectedValue(new TypeError("offline"));
    render(<Harness user={user} />);
    void requestReauth();
    await screen.findByRole("heading", { name: "Confirm it's you" });

    fireEvent.change(screen.getByTestId("reauth-password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_network_error());
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });
});

function resolveReauthLater() {
  void requestReauth();
}
