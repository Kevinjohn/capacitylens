import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../../auth/authContext";
import { PermissionContext, type PermissionContextValue } from "../../auth/permissionContext";
import { authValue } from "../settings/MembersSection.testSupport";
import { ResourceTeamLink } from "./ResourceTeamLink";

vi.mock("../../data/apiConfig", () => ({ isServerConfigured: () => true }));
afterEach(() => vi.unstubAllGlobals());

function renderLink(permission: PermissionContextValue, auth = authValue()) {
  return render(
    <AuthContext.Provider value={auth}>
      <PermissionContext.Provider value={permission}>
        <MemoryRouter initialEntries={["/resources"]}>
          <Routes>
            <Route path="/resources" element={<ResourceTeamLink />} />
            <Route path="/team" element={<h1>Team &amp; access</h1>} />
          </Routes>
        </MemoryRouter>
      </PermissionContext.Provider>
    </AuthContext.Provider>,
  );
}

describe("Resources entry point to Team", () => {
  it.each(["owner", "admin"] as const)("lets an %s open Team by keyboard without member requests", async (role) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    renderLink({ role, status: "resolved" });
    const link = screen.getByRole("link", { name: "Manage team links" });
    expect(link).toHaveAttribute("href", "/team");
    link.focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Team & access" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["editor", "viewer", null] as const)("does not offer management to %s", (role) => {
    renderLink({ role, status: role === null ? "not-applicable" : "resolved" });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it.each(["pending", "unavailable"] as const)("waits for permission when %s", (status) => {
    renderLink({ role: "owner", status });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not add membership controls to auth-off or demo mode", () => {
    renderLink({ role: "owner", status: "resolved" }, authValue({ authMode: "off", user: null }));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
