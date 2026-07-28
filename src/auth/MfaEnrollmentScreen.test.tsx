import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const enable = vi.fn();
const verifyTotp = vi.fn();
vi.mock("./authClient", () => ({
  authClient: {
    twoFactor: {
      enable: (...args: unknown[]) => enable(...args),
      verifyTotp: (...args: unknown[]) => verifyTotp(...args),
    },
  },
}));

import { MfaEnrollmentScreen } from "./MfaEnrollmentScreen";

const enrollmentConfirmed = () => Promise.resolve(true);

beforeEach(() => {
  enable.mockReset();
  verifyTotp.mockReset();
});

describe("MfaEnrollmentScreen", () => {
  it("sets a descriptive title while rendering outside the app shell", () => {
    document.title = "Schedule · CapacityLens";

    render(<MfaEnrollmentScreen onEnrolled={enrollmentConfirmed} onSignOut={vi.fn()} />);

    expect(document.title).toBe("Secure your account · CapacityLens");
  });

  it("requires recovery-code acknowledgement and a verified TOTP before opening tenant data", async () => {
    enable.mockResolvedValue({
      data: {
        totpURI: "otpauth://totp/CapacityLens:test?secret=ABCDEF&issuer=CapacityLens",
        backupCodes: ["recovery-one", "recovery-two"],
      },
      error: null,
    });
    verifyTotp.mockResolvedValue({ data: { status: true }, error: null });
    const onEnrolled = vi.fn(enrollmentConfirmed);
    render(<MfaEnrollmentScreen onEnrolled={onEnrolled} onSignOut={vi.fn()} />);

    fireEvent.change(screen.getByTestId("mfa-enroll-password"), { target: { value: "current-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("recovery-one")).toBeInTheDocument();
    expect(screen.getByText("recovery-two")).toBeInTheDocument();
    expect(enable).toHaveBeenCalledWith({ password: "current-password", issuer: "CapacityLens" });

    const submit = screen.getByTestId("mfa-enroll-submit");
    const code = screen.getByTestId("mfa-enroll-code");
    expect(code).toHaveFocus();
    fireEvent.change(code, { target: { value: "123456" } });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /stored the recovery codes/i }));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(onEnrolled).toHaveBeenCalledTimes(1));
    expect(verifyTotp).toHaveBeenCalledWith({ code: "123456", trustDevice: false });
  });

  it("surfaces a successful enrollment whose session confirmation fails", async () => {
    enable.mockResolvedValue({
      data: { totpURI: "otpauth://valid", backupCodes: ["recovery-one"] },
      error: null,
    });
    verifyTotp.mockResolvedValue({ data: { status: true }, error: null });
    render(<MfaEnrollmentScreen onEnrolled={() => Promise.resolve(false)} onSignOut={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("recovery-one");
    fireEvent.change(screen.getByTestId("mfa-enroll-code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /stored the recovery codes/i }));
    fireEvent.click(screen.getByTestId("mfa-enroll-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/MFA is enabled.*session could not be confirmed/i);
  });

  it("keeps the enrollment wall closed and surfaces an authentication failure", async () => {
    enable.mockResolvedValue({ data: null, error: { message: "Current password is incorrect." } });
    const onEnrolled = vi.fn(enrollmentConfirmed);
    render(<MfaEnrollmentScreen onEnrolled={onEnrolled} onSignOut={vi.fn()} />);
    const password = screen.getByTestId("mfa-enroll-password");
    expect(password).not.toHaveAttribute("aria-invalid");
    expect(password).not.toHaveAttribute("aria-describedby");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Current password is incorrect.");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute("aria-describedby", alert.id);
    expect(onEnrolled).not.toHaveBeenCalled();
  });

  it("associates a rejected authentication code with the verification input", async () => {
    enable.mockResolvedValue({
      data: {
        totpURI: "otpauth://totp/CapacityLens:test?secret=ABCDEF&issuer=CapacityLens",
        backupCodes: ["recovery-one"],
      },
      error: null,
    });
    verifyTotp.mockResolvedValue({ data: null, error: { message: "Authentication code is incorrect." } });
    render(<MfaEnrollmentScreen onEnrolled={enrollmentConfirmed} onSignOut={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("recovery-one");
    const code = screen.getByTestId("mfa-enroll-code");
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /stored the recovery codes/i }));
    fireEvent.click(screen.getByTestId("mfa-enroll-submit"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Authentication code is incorrect.");
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(code).toHaveAttribute("aria-describedby", alert.id);
  });

  it.each([
    ["missing URI", { backupCodes: ["recovery-one"] }],
    ["blank URI", { totpURI: "   ", backupCodes: ["recovery-one"] }],
    ["missing codes", { totpURI: "otpauth://valid" }],
    ["scalar codes", { totpURI: "otpauth://valid", backupCodes: "recovery-one" }],
    ["empty codes", { totpURI: "otpauth://valid", backupCodes: [] }],
    ["mixed codes", { totpURI: "otpauth://valid", backupCodes: ["recovery-one", 2] }],
    ["blank code", { totpURI: "otpauth://valid", backupCodes: [""] }],
  ])("keeps the start form usable when successful enrollment data has %s", async (_case, data) => {
    enable.mockResolvedValue({ data, error: null });
    render(<MfaEnrollmentScreen onEnrolled={enrollmentConfirmed} onSignOut={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("MFA enrollment returned an invalid response.");
    expect(screen.getByTestId("mfa-enroll-password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    expect(screen.queryByText("1. Add the authenticator entry")).not.toBeInTheDocument();
  });
});
