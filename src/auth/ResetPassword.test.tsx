import { afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "@capacitylens/shared/domain/password";
import { m } from "@/i18n";
import { messageForFailure } from "./resetPasswordFailure";
import { ResetPassword } from "./ResetPassword";

const apiConfigMock = vi.hoisted(() => ({
  isServerConfigured: vi.fn(() => true),
}));

vi.mock("../data/apiConfig", () => ({
  API_BASE: "http://api.test",
  isServerConfigured: apiConfigMock.isServerConfigured,
}));

// Pins the library-shape sniff in messageForFailure (DEFENSIVE-CODING.md §2: a sniff of a library's
// message/body shape must be test-pinned). Better Auth's redeem endpoint answers a 400 with a typed
// `{ code }`; this test locks the mapping from each recognised code — and every unrecognised shape —
// to the exact user-facing message, so a future Better Auth upgrade that renames/drops a code fails
// this test instead of silently regressing to the generic fallback (or worse, staying silent).
describe("ResetPassword — messageForFailure (Better Auth 400 body → surfaced message)", () => {
  it("maps INVALID_TOKEN to the invalid-link message", () => {
    expect(messageForFailure({ code: "INVALID_TOKEN" })).toBe(m.reset_err_invalid());
  });

  it("maps PASSWORD_TOO_SHORT to the short message with MIN_PASSWORD_LENGTH interpolated", () => {
    expect(messageForFailure({ code: "PASSWORD_TOO_SHORT" })).toBe(m.reset_err_short({ min: MIN_PASSWORD_LENGTH }));
  });

  it("maps PASSWORD_TOO_LONG to the long message with MAX_PASSWORD_LENGTH interpolated", () => {
    expect(messageForFailure({ code: "PASSWORD_TOO_LONG" })).toBe(m.reset_err_long({ max: MAX_PASSWORD_LENGTH }));
  });

  it("falls back to the generic message for an unrecognised code", () => {
    expect(messageForFailure({ code: "SOME_FUTURE_CODE" })).toBe(m.reset_err_generic());
  });

  it("falls back to the generic message when code is missing", () => {
    expect(messageForFailure({})).toBe(m.reset_err_generic());
  });

  it("maps an unmounted reset endpoint to terminal administrator guidance", () => {
    expect(messageForFailure({}, 404)).toBe(m.reset_err_unavailable());
  });

  it("falls back to the generic message for a non-object body (e.g. a bare JSON `null`)", () => {
    // The call site casts an untyped fetch body `as { code?: string }` without validating shape —
    // a server that answers valid-but-unexpected JSON (null, a string, an array) must not throw here.
    expect(messageForFailure(null as unknown as { code?: string })).toBe(m.reset_err_generic());
  });
});

describe("ResetPassword — one-shot request outcomes", () => {
  afterEach(() => {
    apiConfigMock.isServerConfigured.mockReturnValue(true);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderForm(path = "/reset-password/single-use-token", route = "/reset-password/:token") {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={<ResetPassword />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  function submitPasswords(password: string, confirmation = password) {
    fireEvent.change(screen.getByTestId("reset-new-password"), {
      target: { value: password },
    });
    fireEvent.change(screen.getByTestId("reset-confirm-password"), {
      target: { value: confirmation },
    });
    fireEvent.click(screen.getByTestId("reset-submit"));
  }

  it("rejects submission when the route token is missing without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderForm("/reset-password", "/reset-password");

    submitPasswords("valid-new-password-123");

    expect(await screen.findByText(m.reset_err_missing_token())).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { password: "short", label: "too short", expected: () => m.reset_err_short({ min: MIN_PASSWORD_LENGTH }) },
    {
      password: "x".repeat(MAX_PASSWORD_LENGTH + 1),
      label: "too long",
      expected: () => m.reset_err_long({ max: MAX_PASSWORD_LENGTH }),
    },
  ])("rejects a password that is $label without fetching", async ({ password, expected }) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    submitPasswords(password);

    expect(await screen.findByText(expected())).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a mismatched confirmation without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    submitPasswords("valid-new-password-123", "different-new-password-123");

    expect(await screen.findByText(m.reset_err_mismatch())).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the terminal success state after a successful reset", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    renderForm();

    submitPasswords("valid-new-password-123");

    expect(await screen.findByTestId("reset-success")).toHaveTextContent(m.reset_success());
    expect(screen.queryByText(m.reset_unknown_outcome())).not.toBeInTheDocument();
    expect(screen.queryByTestId("reset-submit")).not.toBeInTheDocument();
  });

  it("treats a transport rejection as unknown and does not reopen the form", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderForm();

    submitPasswords("valid-new-password-123");

    expect(await screen.findByTestId("reset-success")).toHaveTextContent(m.reset_unknown_outcome());
    expect(screen.queryByTestId("reset-submit")).not.toBeInTheDocument();
  });

  it("explains that password reset is unavailable in demo mode without rendering a form", () => {
    apiConfigMock.isServerConfigured.mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderForm();

    expect(screen.getByText(m.reset_local_mode({ app: "CapacityLens" }))).toBeInTheDocument();
    expect(screen.queryByTestId("reset-submit")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([408, 503])("treats HTTP %s as unknown and prevents blind token resubmission", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));

    renderForm();
    submitPasswords("valid-new-password-123");

    expect(await screen.findByText(/reset request had an unknown outcome/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/");
    expect(screen.queryByTestId("reset-submit")).not.toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it("explains that reset is unavailable when the endpoint is not mounted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    renderForm();
    submitPasswords("valid-new-password-123");

    expect(await screen.findByText(/password reset is not available on this instance/i)).toBeInTheDocument();
    expect(screen.queryByText(/please try again/i)).not.toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });
});
