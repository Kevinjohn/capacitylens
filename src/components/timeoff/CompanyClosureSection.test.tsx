import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermissionContext } from "../../auth/permissionContext";
import { DEFAULT_ACCOUNT_ID, resetStoreWithAccount } from "../../test/fixtures";
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
  it("has a labelled empty state and one heading action", () => {
    render(<CompanyClosureSection />);

    expect(screen.getByTestId("company-closures-section")).toHaveAccessibleName("Company closures");
    expect(screen.getByTestId("company-closures-empty")).toHaveTextContent("No company closures planned.");
    expect(screen.getByRole("button", { name: "Add closure" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a closure" })).not.toBeInTheDocument();
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
    expect(row).toHaveTextContent("Sat 1st – Wed 5th Aug");
    // The action names repeat the row's own visible range, so speaking what is on screen
    // addresses the right button.
    expect(screen.getByRole("button", { name: "Edit Summer shutdown closure, Sat 1st – Wed 5th Aug" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete Summer shutdown closure, Sat 1st – Wed 5th Aug" })).toBeVisible();
  });

  it("removes an expired closure when the company week rolls over while mounted", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T23:59:59.000Z"));
    useStore.getState().updateAccount(DEFAULT_ACCOUNT_ID, { timezone: "Etc/GMT", weekStartsOn: 1 });
    useStore.getState().addClosure({
      name: "Wayne Enterprises shutdown",
      startDate: "2026-06-07",
      endDate: "2026-06-07",
    });

    render(<CompanyClosureSection />);
    expect(screen.getByTestId("company-closure-row")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(1_000));

    expect(screen.queryByTestId("company-closure-row")).not.toBeInTheDocument();
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
