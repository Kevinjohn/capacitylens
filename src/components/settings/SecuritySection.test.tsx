import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const listSessions = vi.fn();
const changePassword = vi.fn();
const revokeOwnSession = vi.fn();
vi.mock("../../auth/authClient", () => ({
  authClient: {
    changePassword: (...args: unknown[]) => changePassword(...args),
  },
}));
vi.mock("../../account/accountClient", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../account/accountClient")>();
  return {
    ...original,
    accountClient: {
      ...original.accountClient,
      listSessions: (...args: unknown[]) => listSessions(...args),
      revokeOwnSession: (...args: unknown[]) => revokeOwnSession(...args),
    },
  };
});

import { SecuritySection } from "./SecuritySection";
import { m } from "@/i18n";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@capacitylens/shared/domain/password";

const SESSION = {
  id: "opaque-session-handle",
  createdAt: "2026-07-14T12:00:00.000Z",
  expiresAt: "2026-07-15T00:00:00.000Z",
  current: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  // Each invocation needs a fresh Response because response bodies are single-use.
  listSessions
    .mockReset()
    .mockImplementation(() => Promise.resolve(jsonResponse([SESSION])));
  changePassword.mockReset();
  revokeOwnSession.mockReset();
});

describe("SecuritySection", () => {
  it("renders its security controls from the message catalogue", async () => {
    render(<SecuritySection />);

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: m.settings_security_title(),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(m.settings_security_description()),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(m.settings_security_current_password()),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(m.settings_security_new_password()),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(m.settings_security_confirm_password()),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(m.settings_security_change_password()),
    ).toHaveLength(2);
    expect(
      screen.getByText(m.settings_security_active_sessions()),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(m.settings_security_signed_in_session()),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: m.settings_security_revoke() }),
    ).toBeInTheDocument();
  });

  it("lists active sessions without rendering their bearer tokens and revokes the selected session", async () => {
    revokeOwnSession.mockResolvedValue(new Response(null, { status: 204 }));
    render(<SecuritySection />);
    expect(
      await screen.findByText(m.settings_security_signed_in_session()),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(SESSION.id);

    fireEvent.click(
      screen.getByRole("button", { name: m.settings_security_revoke() }),
    );
    await waitFor(() =>
      expect(revokeOwnSession).toHaveBeenCalledWith(SESSION.id),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      m.settings_security_revoked(),
    );
  });

  it("changes a password only with matching policy-compliant values and revokes other sessions", async () => {
    changePassword.mockResolvedValue({ data: { status: true }, error: null });
    render(<SecuritySection />);
    await screen.findByText(m.settings_security_signed_in_session());
    fireEvent.change(
      screen.getByLabelText(m.settings_security_current_password()),
      { target: { value: "current-password" } },
    );
    fireEvent.change(
      screen.getByLabelText(m.settings_security_new_password()),
      { target: { value: "a-strong-new-password" } },
    );
    fireEvent.change(
      screen.getByLabelText(m.settings_security_confirm_password()),
      { target: { value: "a-strong-new-password" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: m.settings_security_change_password(),
      }),
    );

    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: "current-password",
        newPassword: "a-strong-new-password",
        revokeOtherSessions: true,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      m.settings_security_password_changed(),
    );
  });

  it("reloads through the authentication wall when the current session is revoked", async () => {
    const realLocation = window.location;
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, reload },
    });
    listSessions.mockResolvedValue(
      jsonResponse([{ ...SESSION, current: true }]),
    );
    revokeOwnSession.mockResolvedValue(new Response(null, { status: 204 }));
    try {
      render(<SecuritySection />);
      await screen.findByText(m.settings_security_current_session());
      fireEvent.click(
        screen.getByRole("button", { name: m.settings_security_revoke() }),
      );
      await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: realLocation,
      });
    }
  });

  it("reloads through the authentication wall when current-session revocation has an unknown outcome", async () => {
    const realLocation = window.location;
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, reload },
    });
    listSessions.mockResolvedValue(
      jsonResponse([{ ...SESSION, current: true }]),
    );
    revokeOwnSession.mockRejectedValueOnce(new TypeError("network failed"));
    try {
      render(<SecuritySection />);
      await screen.findByText(m.settings_security_current_session());
      fireEvent.click(
        screen.getByRole("button", { name: m.settings_security_revoke() }),
      );
      await waitFor(() => expect(reload).toHaveBeenCalledOnce());
      expect(listSessions).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: realLocation,
      });
    }
  });

  it("rejects mismatched new passwords without contacting the authentication service", async () => {
    render(<SecuritySection />);
    fireEvent.change(
      screen.getByLabelText(m.settings_security_current_password()),
      { target: { value: "current-password" } },
    );
    fireEvent.change(
      screen.getByLabelText(m.settings_security_new_password()),
      { target: { value: "a-strong-new-password" } },
    );
    fireEvent.change(
      screen.getByLabelText(m.settings_security_confirm_password()),
      { target: { value: "a-different-password" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: m.settings_security_change_password(),
      }),
    );
    const error = await screen.findByRole("alert");
    const confirmation = screen.getByLabelText(
      m.settings_security_confirm_password(),
    );
    expect(error).toHaveTextContent(
      m.settings_security_err_password_mismatch(),
    );
    expect(confirmation).toHaveAttribute("aria-invalid", "true");
    expect(confirmation).toHaveAttribute("aria-describedby", error.id);
    expect(
      screen.getByLabelText(m.settings_security_new_password()),
    ).not.toHaveAttribute("aria-invalid");
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("associates a password-length error with the new-password input", async () => {
    render(<SecuritySection />);
    fireEvent.change(
      screen.getByLabelText(m.settings_security_current_password()),
      { target: { value: "current-password" } },
    );
    fireEvent.change(
      screen.getByLabelText(m.settings_security_new_password()),
      { target: { value: "short" } },
    );
    fireEvent.change(
      screen.getByLabelText(m.settings_security_confirm_password()),
      { target: { value: "short" } },
    );
    fireEvent.submit(
      screen
        .getByLabelText(m.settings_security_new_password())
        .closest("form")!,
    );

    const error = await screen.findByRole("alert");
    const password = screen.getByLabelText(m.settings_security_new_password());
    expect(error).toHaveTextContent(
      m.settings_security_err_password_length({
        min: MIN_PASSWORD_LENGTH,
        max: MAX_PASSWORD_LENGTH,
      }),
    );
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute("aria-describedby", error.id);
    expect(
      screen.getByLabelText(m.settings_security_confirm_password()),
    ).not.toHaveAttribute("aria-invalid");
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("surfaces session-list failures instead of silently presenting an empty device list", async () => {
    listSessions.mockResolvedValue(
      jsonResponse({ error: "Sessions are temporarily unavailable." }, 503),
    );
    render(<SecuritySection />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      m.settings_security_err_sessions_load(),
    );
  });

  it("rejects an invalid session list without rendering its valid subset", async () => {
    listSessions.mockResolvedValue(
      jsonResponse([SESSION, { ...SESSION, id: "short" }]),
    );
    render(<SecuritySection />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      m.settings_security_err_sessions_invalid(),
    );
    expect(
      screen.queryByText(m.settings_security_signed_in_session()),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: m.settings_security_revoke() }),
    ).not.toBeInTheDocument();
  });

  it("surfaces password and session-revocation failures without reporting success", async () => {
    changePassword.mockResolvedValue({
      data: null,
      error: { message: "Current password is incorrect." },
    });
    revokeOwnSession.mockResolvedValue(
      jsonResponse({ error: "That session no longer exists." }, 404),
    );
    render(<SecuritySection />);
    await screen.findByText(m.settings_security_signed_in_session());

    fireEvent.change(
      screen.getByLabelText(m.settings_security_current_password()),
      { target: { value: "wrong-current-password" } },
    );
    fireEvent.change(
      screen.getByLabelText(m.settings_security_new_password()),
      { target: { value: "a-strong-new-password" } },
    );
    fireEvent.change(
      screen.getByLabelText(m.settings_security_confirm_password()),
      { target: { value: "a-strong-new-password" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: m.settings_security_change_password(),
      }),
    );
    const passwordError = await screen.findByRole("alert");
    const currentPassword = screen.getByLabelText(
      m.settings_security_current_password(),
    );
    expect(passwordError).toHaveTextContent("Current password is incorrect.");
    expect(currentPassword).toHaveAttribute("aria-invalid", "true");
    expect(currentPassword).toHaveAttribute(
      "aria-describedby",
      passwordError.id,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: m.settings_security_revoke() }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      m.settings_security_err_revoke(),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("reconciles the session list after a transport-level revoke failure", async () => {
    revokeOwnSession.mockRejectedValueOnce(new TypeError("network failed"));
    render(<SecuritySection />);
    await screen.findByText(m.settings_security_signed_in_session());

    fireEvent.click(
      screen.getByRole("button", { name: m.settings_security_revoke() }),
    );

    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("status")).toHaveTextContent(
      m.settings_security_revoke_unknown_refreshed(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
