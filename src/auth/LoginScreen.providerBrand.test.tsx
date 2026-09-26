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

  it("puts Google before the password fallback", () => {
    render(<LoginScreen authMode="password-and-sso" providers={[google]} onSignedIn={vi.fn()} />);
    const googleButton = screen.getByRole("button", { name: "Sign in with Google" });
    expect(
      googleButton.compareDocumentPosition(screen.getByLabelText("Email")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("or use your password")).toBeInTheDocument();
  });

  it("renders both configured company providers once with their own branding", () => {
    render(<LoginScreen authMode="sso-only" providers={[google, microsoft]} onSignedIn={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: "Sign in with Google" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Sign in with Microsoft" })).toHaveLength(1);
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });
});
