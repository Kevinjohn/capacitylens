import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "@/auth/authContext";

const demoMode = vi.hoisted(() => ({ active: false }));
vi.mock("@/lib/fakeAuth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/fakeAuth")>();
  return { ...original, useDemoAuthActive: () => demoMode.active };
});
vi.mock("../settings/SecuritySection", () => ({ SecuritySection: () => <section>Personal security</section> }));

import { AccountView } from "./AccountView";

const auth = (authMode: AuthContextValue["authMode"]): AuthContextValue => ({
  authMode,
  user: authMode === "off" ? null : { id: "u1", name: "Diana Prince", email: "diana@example.test" },
  canCreateAccount: true,
  multiAccount: true,
  refreshAuth: async () => {},
  signOut: async () => {},
});

describe("AccountView", () => {
  it.each(["password", "sso"] as const)("shows identity and existing security in %s mode", (mode) => {
    render(
      <AuthContext.Provider value={auth(mode)}>
        <AccountView />
      </AuthContext.Provider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("Diana Prince")).toBeInTheDocument();
    expect(screen.getByText("diana@example.test")).toBeInTheDocument();
    expect(screen.getByText("Personal security")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("accurately describes auth-off mode without credential controls", () => {
    render(
      <AuthContext.Provider value={auth("off")}>
        <AccountView />
      </AuthContext.Provider>,
    );
    expect(screen.getByText("Sign-in is off")).toBeInTheDocument();
    expect(screen.queryByText("Personal security")).not.toBeInTheDocument();
  });

  it("identifies the cosmetic demo persona without claiming credential security", () => {
    demoMode.active = true;
    render(
      <AuthContext.Provider value={auth("off")}>
        <AccountView />
      </AuthContext.Provider>,
    );
    expect(screen.getByText("Bruce Wayne")).toBeInTheDocument();
    expect(screen.getByText("Demo access")).toBeInTheDocument();
    expect(screen.queryByText("Personal security")).not.toBeInTheDocument();
    demoMode.active = false;
  });
});
