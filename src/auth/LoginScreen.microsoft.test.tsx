import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signInSocial = vi.hoisted(() => vi.fn());
vi.mock("./authClient", () => ({
  authClient: { signIn: { social: (...args: unknown[]) => signInSocial(...args) } },
}));

import { LoginScreen } from "./LoginScreen";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  signInSocial.mockReset();
});

describe("LoginScreen — Microsoft first-owner verification", () => {
  it.each(["password", "sso"] as const)("starts the verified bootstrap intent in %s mode", async (authMode) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ url: "https://login.microsoftonline.com/authorize" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <LoginScreen
        authMode={authMode}
        needsSetup
        providers={[{ id: "microsoft", label: "Microsoft", kind: "social", brand: "microsoft", experimental: false }]}
        onSignedIn={vi.fn()}
      />,
    );

    if (authMode === "sso") {
      expect(screen.queryByLabelText("password")).not.toBeInTheDocument();
      expect(screen.queryByTestId("owner-setup-submit")).not.toBeInTheDocument();
    }
    await user.type(screen.getByLabelText("email"), "Owner@Example.com");
    await user.click(screen.getByRole("button", { name: "Sign in with Microsoft" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/account/microsoft/start");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toMatchObject({
      purpose: "bootstrap",
      email: "owner@example.com",
      callbackURL: "http://localhost:3000/",
    });
    expect(signInSocial).not.toHaveBeenCalled();
  });
});

it.each([false, true])(
  "promotes Microsoft alongside company sign-in before password entry (Google %s)",
  (withGoogle) => {
    render(
      <LoginScreen
        authMode="password"
        providers={[
          ...(withGoogle ? [{ id: "google", label: "Google", kind: "social", experimental: false } as const] : []),
          { id: "microsoft", label: "Microsoft", kind: "social", experimental: false },
        ]}
        onSignedIn={vi.fn()}
      />,
    );
    const microsoft = screen.getByRole("button", { name: "Sign in with Microsoft" });
    const password = screen.getByLabelText("Password");
    expect(microsoft.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    if (withGoogle) {
      const google = screen.getByRole("button", { name: "Sign in with Google" });
      expect(google.parentElement).toBe(microsoft.parentElement);
    }
  },
);

it("associates an invalid bootstrap email with its visible error", async () => {
  render(
    <LoginScreen
      authMode="sso"
      needsSetup
      providers={[{ id: "microsoft", label: "Microsoft", kind: "social", experimental: false }]}
      onSignedIn={vi.fn()}
    />,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Sign in with Microsoft" }));
  const email = screen.getByLabelText("email");
  expect(email).toHaveAttribute("aria-invalid", "true");
  const errorId = email.getAttribute("aria-describedby");
  expect(errorId).toBeTruthy();
  expect(document.getElementById(errorId ?? "")).toHaveTextContent(/email/i);
  expect(signInSocial).not.toHaveBeenCalled();
});
