import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const client = vi.hoisted(() => ({
  getStatus: vi.fn(),
  confirm: vi.fn(),
  resend: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("./microsoftConnectionClient", () => ({
  getMicrosoftConnectionStatus: client.getStatus,
  confirmMicrosoftConnection: client.confirm,
  resendMicrosoftConnection: client.resend,
  cancelMicrosoftConnection: client.cancel,
}));

import { MicrosoftVerificationScreen } from "./MicrosoftVerificationScreen";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.clearAllMocks();
});

describe("MicrosoftVerificationScreen", () => {
  it("removes the mail token from the URL and waits for an explicit confirmation", async () => {
    client.getStatus.mockResolvedValue({ state: "pending", emailHint: "a…@example.com" });
    client.confirm.mockResolvedValue({ url: "https://login.microsoftonline.com/authorize" });
    const localSet = vi.spyOn(Storage.prototype, "setItem");
    window.history.replaceState({}, "", "/verify-microsoft?state=check-email#token=mail-proof-secret");
    render(
      <StrictMode>
        <MicrosoftVerificationScreen />
      </StrictMode>,
    );

    await screen.findByText("a…@example.com");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("mail-proof-secret");
    expect(localSet).not.toHaveBeenCalled();
    expect(client.confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm and continue" }));
    await waitFor(() => expect(client.confirm).toHaveBeenCalledWith("mail-proof-secret"));
  });

  it("offers retry, resend, and cancel after request failures without reporting success", async () => {
    client.getStatus.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue({ state: "pending" });
    client.resend.mockRejectedValueOnce(new Error("delivery unavailable"));
    client.cancel.mockResolvedValue({ ok: true });
    window.history.replaceState({}, "", "/verify-microsoft?state=check-email");
    render(<MicrosoftVerificationScreen />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not check the verification request");
    expect(screen.queryByRole("button", { name: "Resend verification email" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel request" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Check your email for a verification link/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Resend verification email" });
    fireEvent.click(screen.getByRole("button", { name: "Resend verification email" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("verification request could not be completed");
    expect(screen.queryByText("Email sent")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    expect(await screen.findByText(/verification request was canceled/)).toBeInTheDocument();
  });

  it("discards the old email token after a successful resend", async () => {
    client.getStatus.mockResolvedValue({ state: "pending" });
    client.resend.mockResolvedValue({ ok: true });
    window.history.replaceState({}, "", "/verify-microsoft#token=old-proof");
    render(<MicrosoftVerificationScreen />);

    await screen.findByRole("button", { name: "Confirm and continue" });
    fireEvent.click(screen.getByRole("button", { name: "Resend verification email" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirm and continue" })).not.toBeInTheDocument());
    expect(client.confirm).not.toHaveBeenCalled();
  });

  it("allows an approved confirmation retry without offering a new email", async () => {
    client.getStatus.mockResolvedValue({ state: "approved" });
    client.confirm.mockRejectedValue(new Error("connection interrupted"));
    window.history.replaceState({}, "", "/verify-microsoft#token=approved-proof");
    render(<MicrosoftVerificationScreen />);

    const continueButton = await screen.findByRole("button", { name: "Continue to Microsoft" });
    expect(screen.queryByRole("button", { name: "Resend verification email" })).not.toBeInTheDocument();
    fireEvent.click(continueButton);
    await screen.findByRole("alert");
    fireEvent.click(continueButton);
    await waitFor(() => expect(client.confirm).toHaveBeenCalledTimes(2));
    expect(client.confirm).toHaveBeenLastCalledWith("approved-proof");
  });

  it("resumes an approved browser request after reload without keeping the email token", async () => {
    client.getStatus.mockResolvedValue({ state: "approved" });
    client.confirm.mockRejectedValue(new Error("connection interrupted"));
    window.history.replaceState({}, "", "/verify-microsoft");
    render(<MicrosoftVerificationScreen />);

    fireEvent.click(await screen.findByRole("button", { name: "Continue to Microsoft" }));
    await waitFor(() => expect(client.confirm).toHaveBeenCalledWith(undefined));
    expect(screen.queryByRole("button", { name: "Resend verification email" })).not.toBeInTheDocument();
  });

  it("reports failed delivery and clears the warning after a successful resend", async () => {
    client.getStatus.mockResolvedValue({ state: "pending", deliveryUnavailable: true });
    client.resend.mockResolvedValue({ ok: true });
    window.history.replaceState({}, "", "/verify-microsoft?state=check-email");
    render(<MicrosoftVerificationScreen />);

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not send your verification email");
    expect(screen.queryByText(/Check your email for a verification link/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resend verification email" }));
    await screen.findByText(/A verification email was sent/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
