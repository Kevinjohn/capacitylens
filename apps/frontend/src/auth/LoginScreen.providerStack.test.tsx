import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginScreen } from "./LoginScreen";

vi.mock("./authClient", () => ({
  authClient: {
    signIn: { email: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
  },
}));

describe("Google provider placement", () => {
  const google = { id: "google", label: "Google", kind: "social", experimental: false } as const;

  it("places Google before the password fallback in the keyboard order", async () => {
    const user = userEvent.setup();
    render(<LoginScreen authMode="password-and-sso" providers={[google]} onSignedIn={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Sign in with Google" });
    const email = screen.getByLabelText("Email");
    expect(button.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("or use your password")).toBeInTheDocument();
    await user.tab();
    expect(button).toHaveFocus();
  });

  it("keeps first-owner setup ahead of the configured Google action", () => {
    render(<LoginScreen authMode="password-and-sso" needsSetup providers={[google]} onSignedIn={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Create my sign-in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.getByLabelText("name")).toBeInTheDocument();
  });

  it("keeps password-only sign-in free of provider controls", () => {
    render(<LoginScreen authMode="password-only" onSignedIn={vi.fn()} />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });
});
