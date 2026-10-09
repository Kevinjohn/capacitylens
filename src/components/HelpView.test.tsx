import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionContext } from "@/auth/permissionContext";
import type { Role } from "@capacitylens/shared/domain/access";
import { HelpView } from "./HelpView";

const tourMock = vi.hoisted(() => ({
  startTour: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));
vi.mock("@/lib/tour", () => ({ startTour: tourMock.startTour }));

beforeEach(() => tourMock.startTour.mockReset().mockResolvedValue(undefined));

function renderHelp(role: Role) {
  return render(
    <PermissionContext.Provider value={{ role, status: "resolved" }}>
      <MemoryRouter initialEntries={["/help"]}>
        <HelpView />
      </MemoryRouter>
    </PermissionContext.Provider>,
  );
}

describe("HelpView", () => {
  it.each(["owner", "admin", "editor", "viewer"] as const)("offers the shared role tour to %s", async (role) => {
    const user = userEvent.setup();
    renderHelp(role);

    expect(screen.getByRole("heading", { name: "Help" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse the user guides" })).toHaveAttribute("href", "/using/");
    const launcher = screen.getByTestId("show-tour");
    expect(launcher).toBeEnabled();
    await user.click(launcher);

    expect(tourMock.startTour).toHaveBeenCalledWith(expect.objectContaining({ role }));
  });
});
