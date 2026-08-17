import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermissionContext } from "../../auth/permissionContext";
import { resetStoreWithAccount } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { CompanyClosureSection } from "./CompanyClosureSection";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-03T12:00:00.000Z"));
  resetStoreWithAccount();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CompanyClosureSection", () => {
  it("has its own labelled empty state and create affordances", () => {
    render(<CompanyClosureSection />);

    expect(screen.getByTestId("company-closures-section")).toHaveAccessibleName("Company closures");
    expect(screen.getByTestId("company-closures-empty")).toHaveTextContent("No company closures planned.");
    expect(screen.getByRole("button", { name: "Add closure" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a closure" })).toBeInTheDocument();
  });

  it("shows the required name and complete inclusive date span", () => {
    useStore.getState().addClosure({
      name: "Summer shutdown",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
    });

    render(<CompanyClosureSection />);

    const row = screen.getByTestId("company-closure-row");
    expect(row).toHaveTextContent("Summer shutdown");
    expect(row).toHaveTextContent("Sat 1st Aug – Wed 5th Aug");
  });

  it("confirms deletion and keeps the store mutation undoable", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    useStore.getState().addClosure({
      name: "Summer shutdown",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
    });
    render(<CompanyClosureSection />);

    await user.click(screen.getByRole("button", { name: /Delete Summer shutdown closure/ }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete closure?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(useStore.getState().data.closures).toHaveLength(0);

    useStore.getState().undo();
    expect(useStore.getState().data.closures).toHaveLength(1);
  });

  it("keeps closure mutation controls hidden for viewers", () => {
    useStore.getState().addClosure({
      name: "Summer shutdown",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
    });
    render(
      <PermissionContext.Provider value={{ role: "viewer" }}>
        <CompanyClosureSection />
      </PermissionContext.Provider>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("company-closure-row")).toBeInTheDocument();
  });
});
