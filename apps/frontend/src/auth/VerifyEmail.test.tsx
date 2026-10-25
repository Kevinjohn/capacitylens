import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { authClient } from "./authClient";
import { VerifyEmail } from "./VerifyEmail";

const chosen = "chosen-password-2026";

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/verify-email/single-use-token"]}>
      <Routes>
        <Route path="/verify-email/:token" element={<VerifyEmail />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("VerifyEmail outcomes", () => {
  it("offers a retry, not an invalid link, when the link cannot be checked", async () => {
    vi.spyOn(authClient, "inspectEmailVerification")
      .mockResolvedValueOnce({ data: null, error: { message: "Unavailable", status: 503 } })
      .mockResolvedValueOnce({ data: { valid: true }, error: null });
    renderPage();
    expect(await screen.findByTestId("verify-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("verify-invalid")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("verify-password")).toBeInTheDocument();
  });

  it("still reports a link the server rejected as invalid", async () => {
    vi.spyOn(authClient, "inspectEmailVerification").mockResolvedValue({ data: { valid: false }, error: null });
    renderPage();
    expect(await screen.findByTestId("verify-invalid")).toBeInTheDocument();
  });

  it("reports a committed confirmation as done even when a later step failed", async () => {
    vi.spyOn(authClient, "inspectEmailVerification").mockResolvedValue({ data: { valid: true }, error: null });
    vi.spyOn(authClient, "completeEmailVerification").mockResolvedValue({
      data: null,
      error: { message: "Confirmed", status: 503, code: "VERIFICATION_COMMITTED" },
    });
    renderPage();
    fireEvent.change(await screen.findByTestId("verify-password"), { target: { value: chosen } });
    fireEvent.click(screen.getByTestId("verify-submit"));
    expect(await screen.findByTestId("verify-success")).toBeInTheDocument();
    expect(screen.queryByTestId("verify-uncertain")).not.toBeInTheDocument();
  });

  it("does not return to the form when the confirmation answer is lost", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(authClient, "inspectEmailVerification").mockResolvedValue({ data: { valid: true }, error: null });
    const complete = vi.spyOn(authClient, "completeEmailVerification").mockRejectedValue(new TypeError("offline"));
    renderPage();
    fireEvent.change(await screen.findByTestId("verify-password"), { target: { value: chosen } });
    fireEvent.click(screen.getByTestId("verify-submit"));
    expect(await screen.findByTestId("verify-uncertain")).toBeInTheDocument();
    expect(screen.queryByTestId("verify-password")).not.toBeInTheDocument();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Go to sign in" })).toBeInTheDocument();
  });
});
