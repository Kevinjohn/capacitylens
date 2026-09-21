import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "@/auth/authContext";

const demoMode = vi.hoisted(() => ({ active: false }));
vi.mock("@/lib/fakeAuth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/fakeAuth")>();
  return { ...original, useDemoAuthActive: () => demoMode.active };
});
vi.mock("../settings/SecuritySection", () => ({
  SecuritySection: ({ passwordOpen }: { passwordOpen: boolean }) => (
    <section>{passwordOpen ? "Password dialog open" : "Personal security"}</section>
  ),
}));

import { AccountView } from "./AccountView";

const signOut = vi.fn();
function auth(
  authMode: AuthContextValue["authMode"],
  reauthMethod: AuthContextValue["reauthMethod"] = "password",
): AuthContextValue {
  return {
    authMode,
    reauthMethod,
    user: authMode === "off" ? null : { id: "u1", name: "Diana Prince", email: "diana@example.test" },
    canCreateAccount: true,
    multiAccount: true,
    refreshAuth: async () => {},
    signOut,
  };
}

function renderAccount(mode: AuthContextValue["authMode"], method?: AuthContextValue["reauthMethod"]) {
  return render(
    <AuthContext.Provider value={auth(mode, method)}>
      <AccountView />
    </AuthContext.Provider>,
  );
}

describe("AccountView", () => {
  it("uses separate single-line table cells and reveals the full truncated email on focus", async () => {
    renderAccount("password");
    expect(screen.getByRole("heading", { level: 1, name: "Account" }).parentElement?.parentElement).toHaveClass(
      "max-w-4xl",
    );
    const row = screen.getByTestId("account-identity-row");
    expect(row).toHaveTextContent("Diana Prince");
    expect(row.querySelectorAll("td")).toHaveLength(4);
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Name",
      "Email",
      "Access",
      "Actions",
    ]);
    expect(row.querySelector("td")?.textContent).toContain("Diana Prince");
    expect(screen.getByRole("table").parentElement).toHaveClass("overflow-x-auto");
    expect(screen.getByRole("table")).toHaveClass("min-w-[41rem]", "table-fixed");
    expect(screen.getByRole("table").querySelectorAll("col")).toHaveLength(4);
    const email = screen.getByLabelText("diana@example.test");
    expect(email).toHaveAttribute("tabindex", "0");
    expect(email).toHaveClass("truncate");
    fireEvent.focus(email);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("diana@example.test");
    expect(screen.queryByText("Signed in")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByText("Password dialog open")).toBeInTheDocument();
  });

  it("signs out immediately", () => {
    signOut.mockClear();
    renderAccount("password");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("shows email in its own cell when the displayed name falls back to email", () => {
    render(
      <AuthContext.Provider value={{ ...auth("password"), user: { id: "u1", email: "diana@example.test" } }}>
        <AccountView />
      </AuthContext.Provider>,
    );
    const cells = screen.getByTestId("account-identity-row").querySelectorAll("td");
    expect(cells[0]).toHaveTextContent("diana@example.test");
    expect(cells[1]).toHaveTextContent("diana@example.test");
    expect(screen.getByLabelText("diana@example.test")).toHaveClass("truncate");
  });

  it.each([
    ["sso", "provider"],
    ["password", "provider"],
  ] as const)("does not offer local password change for %s/%s", (mode, method) => {
    renderAccount(mode, method);
    expect(screen.queryByRole("button", { name: "Change password" })).not.toBeInTheDocument();
  });

  it("does not invent credential controls when authentication is off", () => {
    renderAccount("off");
    expect(screen.getByText("Sign-in is off")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change password" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("shows the cosmetic demo identity without password controls", () => {
    demoMode.active = true;
    try {
      renderAccount("off");
      expect(screen.getByText("Bruce Wayne")).toBeInTheDocument();
      expect(screen.getByText("Demo access")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Change password" })).not.toBeInTheDocument();
    } finally {
      demoMode.active = false;
    }
  });
});
