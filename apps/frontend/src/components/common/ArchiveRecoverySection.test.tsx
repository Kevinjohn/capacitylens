import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ArchiveRecoveryRow } from "@capacitylens/shared/domain/lifecycle";
import { ArchiveRecoverySection } from "./ArchiveRecoverySection";
const { recovery, unarchive } = vi.hoisted(() => ({ recovery: vi.fn(), unarchive: vi.fn() }));
vi.mock("@/hooks/useArchiveRecovery", () => ({ useArchiveRecovery: recovery }));
vi.mock("@/hooks/useLifecycleActions", () => ({ useLifecycleActions: () => ({ unarchive }) }));
const row: ArchiveRecoveryRow = {
  entity: "projects",
  id: "project",
  label: '"Gotham"',
  archived: true,
  parent: { entity: "clients", id: "client/one", label: '"Wayne"' },
};
beforeEach(() => {
  unarchive.mockReset().mockResolvedValue(undefined);
  recovery.mockReturnValue({ data: { accountId: "a-studio", rows: [row] }, error: null });
});
describe("identity archive rows", () => {
  it("keeps direct restore and encoded parent navigation distinct", async () => {
    render(
      <MemoryRouter>
        <ArchiveRecoverySection entity="projects" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "View archived parent" })).toHaveAttribute(
      "href",
      "/clients#archived-client%2Fone",
    );
    await userEvent.setup().click(screen.getByRole("button", { name: 'Restore "Gotham"' }));
    expect(unarchive).toHaveBeenCalledWith("projects", "project");
    expect(screen.queryByRole("button", { name: /Anonymise/ })).not.toBeInTheDocument();
  });
  it("offers only the parent journey for an active inherited-hidden child", () => {
    recovery.mockReturnValue({ data: { rows: [{ ...row, archived: false }] }, error: null });
    render(
      <MemoryRouter>
        <ArchiveRecoverySection entity="projects" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "View archived parent" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("surfaces failed reads instead of rendering an old list", () => {
    recovery.mockReturnValue({ data: { rows: [row] }, error: "Archive recovery failed" });
    render(
      <MemoryRouter>
        <ArchiveRecoverySection entity="projects" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Archive recovery failed");
    expect(screen.queryByTestId("archived-row")).not.toBeInTheDocument();
  });
});
