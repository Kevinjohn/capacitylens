import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthProviderInfo } from "./authContext";
import { LoginScreen } from "./LoginScreen";

const signInEmail = vi.fn();
vi.mock("./authClient", () => ({
  authClient: {
    signIn: { email: (...args: unknown[]) => signInEmail(...args), social: vi.fn() },
    signUp: { email: vi.fn() },
    twoFactor: { verifyTotp: vi.fn(), verifyBackupCode: vi.fn() },
  },
}));

describe("LoginScreen — mixed-mode Google hierarchy", () => {
  const google = { id: "google", label: "Google", kind: "social", experimental: true } as const;
  const github = { id: "github", label: "GitHub", kind: "social", experimental: true } as const;

  it("puts Google before the password fallback with explicit wording", () => {
    render(<LoginScreen authMode="password" providers={[google]} onSignedIn={vi.fn()} />);

    const googleButton = screen.getByRole("button", { name: "Sign in with Google" });
    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    const signIn = screen.getByRole("button", { name: "Sign in" });

    expect(googleButton.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(email.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(password.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(googleButton.parentElement).toHaveClass("mt-4", "flex", "flex-col", "gap-3");
    expect(googleButton).toHaveClass("w-[180px]", "self-center");
    expect(screen.getByText("or use your password").parentElement).toHaveClass("my-4");
  });
  it("follows keyboard order through every provider and then the password fields", async () => {
    const user = userEvent.setup();
    const microsoft = { id: "microsoft", label: "Microsoft", kind: "social", experimental: false } as const;
    render(<LoginScreen authMode="password" providers={[google, microsoft, github]} onSignedIn={vi.fn()} />);

    const googleButton = screen.getByRole("button", { name: "Sign in with Google" });
    const microsoftButton = screen.getByRole("button", { name: "Sign in with Microsoft" });
    const githubButton = screen.getByRole("button", { name: "Continue with GitHub" });
    const email = screen.getByLabelText("Email");
    expect(email).not.toHaveFocus();

    await user.tab();
    expect(googleButton).toHaveFocus();
    await user.tab();
    expect(microsoftButton).toHaveFocus();
    await user.tab();
    expect(githubButton).toHaveFocus();
    await user.tab();
    expect(email).toHaveFocus();
  });

  it("keeps password email autofocus when Google is not configured", () => {
    render(<LoginScreen authMode="password" onSignedIn={vi.fn()} />);

    expect(screen.getByLabelText("Email")).toHaveFocus();
    expect(screen.queryByText("or use your password")).not.toBeInTheDocument();
  });

  it("keeps the owner name autofocus during first-owner setup", () => {
    render(<LoginScreen authMode="password" needsSetup providers={[google]} onSignedIn={vi.fn()} />);

    expect(screen.getByLabelText("name")).toHaveFocus();
  });

  it("lets the fallback separator rails share the remaining row width", () => {
    render(<LoginScreen authMode="password" providers={[google]} onSignedIn={vi.fn()} />);

    const rails = screen.getAllByRole("none").filter((element) => element.getAttribute("data-slot") === "separator");
    expect(rails).toHaveLength(2);
    for (const rail of rails) {
      expect(rail).toHaveClass("min-w-0", "flex-1", "shrink", "data-[orientation=horizontal]:w-auto");
    }
  });

  it("keeps experimental GitHub after the password fallback", () => {
    render(<LoginScreen authMode="password" providers={[google, github]} onSignedIn={vi.fn()} />);

    const googleButton = screen.getByRole("button", { name: "Sign in with Google" });
    const signIn = screen.getByRole("button", { name: "Sign in" });
    const companyButton = screen.getByRole("button", { name: "Continue with GitHub" });

    expect(googleButton.compareDocumentPosition(companyButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(companyButton.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("or use your password")).toBeInTheDocument();
  });

  it("renders every configured and future provider once in supplied order above the password form", () => {
    // The runtime allowlist grows as providers are added; this fixture confirms layout remains generic.
    const futureProvider = {
      id: "future-idp",
      label: "Future identity",
      kind: "social",
      experimental: false,
    } as unknown as AuthProviderInfo;
    const providers: AuthProviderInfo[] = [
      { id: "microsoft", label: "Microsoft", kind: "social", experimental: false },
      { id: "google", label: "Google", kind: "social", experimental: false },
      github,
      futureProvider,
    ];
    render(<LoginScreen authMode="password" providers={[...providers]} onSignedIn={vi.fn()} />);

    const buttons = [
      screen.getByRole("button", { name: "Sign in with Microsoft" }),
      screen.getByRole("button", { name: "Sign in with Google" }),
      screen.getByRole("button", { name: "Continue with GitHub" }),
      screen.getByRole("button", { name: "Continue with Future identity" }),
    ];
    const email = screen.getByLabelText("Email");
    const signIn = screen.getByRole("button", { name: "Sign in" });

    expect(screen.getAllByRole("button")).toHaveLength(5);
    expect(
      buttons.every((button) => button.classList.contains("w-[180px]") && button.classList.contains("self-center")),
    ).toBe(true);
    expect(buttons.at(-1)).toHaveTextContent("Continue with Future identity");
    for (let index = 0; index < buttons.length; index += 1) {
      const button = buttons[index];
      const next = buttons[index + 1] ?? email;
      if (!button) throw new Error("Expected every configured provider button to render.");
      expect(button.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(email.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText("or use your password")).toHaveLength(1);
  });

  it("does not promote providers in SSO-only mode", () => {
    render(<LoginScreen authMode="sso" providers={[google]} onSignedIn={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByText("or use your password")).not.toBeInTheDocument();
  });

  it("places GitHub above the password form when it is the only provider", () => {
    render(<LoginScreen authMode="password" providers={[github]} onSignedIn={vi.fn()} />);

    const email = screen.getByLabelText("Email");
    const companyButton = screen.getByRole("button", { name: "Continue with GitHub" });
    expect(companyButton.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("or use your password")).toBeInTheDocument();
  });

  it("keeps first-owner setup ahead of its providers and retains their separator", () => {
    render(<LoginScreen authMode="password" needsSetup providers={[google]} onSignedIn={vi.fn()} />);

    const name = screen.getByLabelText("name");
    const googleButton = screen.getByRole("button", { name: "Sign in with Google" });
    const separators = screen
      .getAllByRole("none")
      .filter((element) => element.getAttribute("data-slot") === "separator");
    expect(name.compareDocumentPosition(googleButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("or use your password")).not.toBeInTheDocument();
    expect(separators).toHaveLength(1);
  });

  it("hides the promoted action and fallback while password MFA is pending", async () => {
    signInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
    render(<LoginScreen authMode="password" providers={[google]} onSignedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const code = await screen.findByLabelText("Authentication code");
    expect(code).toBeInTheDocument();
    expect(code).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
    expect(screen.queryByText("or use your password")).not.toBeInTheDocument();
  });

  it("keeps password errors associated with both controls after Google promotion", async () => {
    signInEmail.mockResolvedValue({ error: { message: "Invalid email or password." } });
    render(<LoginScreen authMode="password" providers={[google]} onSignedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    const errorId = alert.getAttribute("id");
    expect(errorId).toBeTruthy();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-describedby", errorId);
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-describedby", errorId);
  });
});
