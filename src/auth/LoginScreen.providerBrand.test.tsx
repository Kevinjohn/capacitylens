import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoginScreen } from "./LoginScreen";

vi.mock("./authClient", () => ({
  authClient: {
    signIn: { email: vi.fn(), oauth2: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
    twoFactor: { verifyTotp: vi.fn(), verifyBackupCode: vi.fn() },
  },
}));

describe("LoginScreen provider brands", () => {
  const googleSocial = { id: "google", label: "Google", kind: "social", experimental: true } as const;
  const googleOidc = {
    id: "sso",
    label: "Google",
    kind: "oidc",
    brand: "google",
    experimental: false,
  } as const;

  it("puts branded Google OIDC before the password fallback", () => {
    render(<LoginScreen authMode="password" providers={[googleOidc]} onSignedIn={vi.fn()} />);

    const googleButton = screen.getByRole("button", { name: "Sign in with Google" });
    const email = screen.getByLabelText("Email");
    expect(googleButton.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("or use your password")).toBeInTheDocument();
  });

  it("keeps both Google methods when social and OIDC are configured", () => {
    render(<LoginScreen authMode="password" providers={[googleSocial, googleOidc]} onSignedIn={vi.fn()} />);

    const googleButtons = screen.getAllByRole("button", { name: "Sign in with Google" });
    expect(googleButtons).toHaveLength(2);
    const socialButton = googleButtons[0];
    const oidcButton = googleButtons[1];
    if (!socialButton || !oidcButton) throw new Error("Expected both Google sign-in methods.");
    const email = screen.getByLabelText("Email");
    const passwordButton = screen.getByRole("button", { name: "Sign in" });
    expect(socialButton.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(passwordButton.compareDocumentPosition(oidcButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
