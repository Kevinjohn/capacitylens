import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoginScreen } from "./LoginScreen";

vi.mock("./authClient", () => ({
  authClient: {
    signIn: { email: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
    twoFactor: { verifyTotp: vi.fn(), verifyBackupCode: vi.fn() },
  },
}));

describe("LoginScreen provider brands", () => {
  const google = { id: "google", label: "Google", kind: "social", experimental: false } as const;
  const microsoft = { id: "microsoft", label: "Microsoft", kind: "social", experimental: false } as const;

  it("keeps the Google artwork intact at its native width in the password fallback stack", () => {
    render(<LoginScreen authMode="password" providers={[google]} onSignedIn={vi.fn()} />);
    const googleButton = screen.getByRole("button", { name: "Sign in with Google" });
    expect(googleButton).toHaveClass("w-[180px]", "self-center");
    for (const markTestId of ["google-mark-light", "google-mark-dark"]) {
      expect(screen.getByTestId(markTestId)).toHaveClass("h-10", "w-[180px]", "object-contain");
    }
    expect(
      googleButton.compareDocumentPosition(screen.getByLabelText("Email")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("or use your password")).toBeInTheDocument();
  });

  it("renders both configured company providers once with their own branding", () => {
    render(<LoginScreen authMode="sso" providers={[google, microsoft]} onSignedIn={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: "Sign in with Google" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Sign in with Microsoft" })).toHaveLength(1);
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });
});
