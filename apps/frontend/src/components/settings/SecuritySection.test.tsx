import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { AuthContext } from "@/auth/authContext";
import type { AuthContextValue } from "@/auth/authContext";
import { m } from "@/i18n";
import { SecuritySection } from "./SecuritySection";

const changePassword = vi.fn();
const readIdentityProvider = vi.fn();
const googleProvider = { id: "google", label: "Google", kind: "social", experimental: false, brand: "google" };
const providerStatus = (connected: boolean) => ({ provider: googleProvider, connected, verified: connected });
vi.mock("@/auth/authClient", () => ({
  authClient: { changePassword: (...args: unknown[]) => changePassword(...args) },
}));
vi.mock("@/account/accountClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/account/accountClient")>();
  return {
    ...original,
    accountClient: {
      ...original.accountClient,
      readIdentityProvider: (...args: unknown[]) => readIdentityProvider(...args),
    },
  };
});

beforeEach(() => {
  changePassword.mockReset();
  readIdentityProvider
    .mockReset()
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(providerStatus(true)), { status: 200 })));
});

const passwordAuth: AuthContextValue = {
  authMode: "password-only",
  user: { id: "u1", email: "diana@example.test" },
  providers: [],
  canCreateAccount: false,
  refreshAuth: async () => {},
  signOut: async () => {},
};

type RenderSecurityOptions = { overrides?: Partial<AuthContextValue>; passwordOpen?: boolean };
function renderSecurity({ overrides = {}, passwordOpen = false }: RenderSecurityOptions = {}) {
  const auth: AuthContextValue = { ...passwordAuth, ...overrides };
  return render(
    <AuthContext.Provider value={auth}>
      <SecuritySection passwordOpen={passwordOpen} />
    </AuthContext.Provider>,
  );
}

it("keeps password controls hidden until the password dialog is opened", () => {
  renderSecurity({});
  expect(screen.queryByLabelText(m.settings_security_current_password())).not.toBeInTheDocument();
});

it("changes a password through the dialog and revokes other sessions", async () => {
  changePassword.mockResolvedValue({ data: { status: true }, error: null });
  renderSecurity({ overrides: {}, passwordOpen: true });
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

it("clears obsolete inputs and reports a committed password change when follow-up cleanup fails", async () => {
  changePassword.mockResolvedValue({
    data: null,
    error: {
      code: "CREDENTIAL_UPDATE_COMMITTED",
      message: "Credential update completed, but a follow-up failed.",
      status: 503,
    },
  });
  renderSecurity({ passwordOpen: true });
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

  expect(await screen.findByRole("status")).toHaveTextContent(m.settings_security_password_changed_warning());
  expect(screen.getByLabelText(m.settings_security_current_password())).toHaveValue("");
  expect(screen.getByLabelText(m.settings_security_new_password())).toHaveValue("");
  expect(screen.getByLabelText(m.settings_security_confirm_password())).toHaveValue("");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps an unconfirmed transport outcome explicit and does not call it a password change", async () => {
  changePassword.mockRejectedValue(new TypeError("fetch failed"));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  renderSecurity({ passwordOpen: true });
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

  expect(await screen.findByRole("alert")).toHaveTextContent(m.settings_security_err_password_outcome_unknown());
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByLabelText(m.settings_security_new_password())).toHaveValue("a-strong-new-password");
  error.mockRestore();
});

it.each(["p".repeat(257), "𠀀".repeat(129)])(
  "rejects an oversized current password without altering or sending it",
  async (value) => {
    renderSecurity({ passwordOpen: true });
    const current = screen.getByLabelText(m.settings_security_current_password());
    fireEvent.change(current, { target: { value } });
    expect(current).toHaveValue(value);
    fireEvent.change(screen.getByLabelText(m.settings_security_new_password()), {
      target: { value: "a-strong-new-password" },
    });
    fireEvent.change(screen.getByLabelText(m.settings_security_confirm_password()), {
      target: { value: "a-strong-new-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: m.settings_security_change_password() }));
    expect(await screen.findByRole("alert")).toHaveTextContent(m.login_password_input_too_long());
    expect(changePassword).not.toHaveBeenCalled();
  },
);

it("accepts an exact 128-code-point astral new password without changing its bytes", async () => {
  changePassword.mockResolvedValue({ data: { status: true }, error: null });
  renderSecurity({ passwordOpen: true });
  const next = "𠀀".repeat(128);
  fireEvent.change(screen.getByLabelText(m.settings_security_current_password()), {
    target: { value: "current-password" },
  });
  fireEvent.change(screen.getByLabelText(m.settings_security_new_password()), { target: { value: next } });
  fireEvent.change(screen.getByLabelText(m.settings_security_confirm_password()), { target: { value: next } });
  fireEvent.click(screen.getByRole("button", { name: m.settings_security_change_password() }));
  await waitFor(() => expect(changePassword).toHaveBeenCalledWith(expect.objectContaining({ newPassword: next })));
});

it("keeps password mismatch validation in the dialog", async () => {
  renderSecurity({ overrides: {}, passwordOpen: true });
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
