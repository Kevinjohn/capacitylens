import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PermissionContext } from "../../auth/permissionContext";
import { DEFAULT_ACCOUNT_ID, makeResource } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { schedulerDataset } from "./__tests__/schedulerTestKit";
import { SchedulerGrid } from "./SchedulerGrid";

beforeEach(() => {
  useStore.getState().replaceAll(schedulerDataset());
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
  useStore.getState().setOriginDate("2026-06-01");
  useStore.getState().setZoom(1);
  useStore.getState().setDrawMode("work");
  useStore.getState().clearFilters();
  useStore.getState().setUtilizationPref("showDiscipline", true);
  useStore.setState((state) => ({ ui: { ...state.ui, collapsedGroups: [], scrollToResource: null } }));
});

describe("SchedulerGrid component identity and row variants", () => {
  it("retains the focused bar and group DOM nodes when the utilisation display changes", () => {
    render(<SchedulerGrid />, { wrapper: MemoryRouter });
    const bar = screen.getByTestId("allocation-bar");
    const group = screen.getByTestId("discipline-group");
    bar.focus();
    act(() => useStore.getState().setUtilizationPref("showDiscipline", false));
    expect(screen.getByTestId("allocation-bar")).toBe(bar);
    expect(screen.getByTestId("discipline-group")).toBe(group);
    expect(bar).toHaveFocus();
    expect(group).not.toHaveTextContent(/avg/);
  });

  it("keeps viewer rows readable without exposing create, draw or edit controls", () => {
    render(
      <PermissionContext.Provider value={{ role: "viewer" }}>
        <SchedulerGrid />
      </PermissionContext.Provider>,
      { wrapper: MemoryRouter },
    );
    expect(screen.getByTestId("scheduler-row")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Add allocation for/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("allocation-bar")).toHaveAttribute("role", "img");
    const trigger = screen.getByRole("button", { name: "View Bruce's schedule" });
    expect(trigger).toBeVisible();
    expect(trigger).toHaveAttribute("data-testid", "person-schedule-trigger");
    expect(within(trigger).getByTestId("person-schedule-avatar")).toBeVisible();
    expect(within(trigger).getByTestId("person-schedule-eye")).toHaveClass(
      "group-hover:opacity-100",
      "group-focus-visible:opacity-100",
    );
    expect(
      within(screen.getByTestId("scheduler-row")).getAllByRole("button", { name: "View Bruce's schedule" }),
    ).toHaveLength(1);
  });
});

describe("SchedulerGrid individual schedule drawer", () => {
  it("opens one read-only schedule sheet without replacing the grid", async () => {
    const user = userEvent.setup();
    render(<SchedulerGrid />, { wrapper: MemoryRouter });
    const grid = screen.getByTestId("scheduler-grid");

    await user.click(screen.getByRole("button", { name: "View Bruce's schedule" }));

    expect(screen.getByRole("dialog", { name: "Bruce's schedule" })).toBeVisible();
    expect(screen.getByTestId("scheduler-grid")).toBe(grid);
    expect(screen.getAllByTestId("person-schedule-sheet")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Edit|Delete|Save|Duplicate/ })).not.toBeInTheDocument();
  });

  it("returns focus to the grid without scrolling when the opener disconnects", async () => {
    const user = userEvent.setup();
    render(<SchedulerGrid />, { wrapper: MemoryRouter });
    const grid = screen.getByTestId("scheduler-grid");
    grid.scrollLeft = 37;
    grid.scrollTop = 19;
    const trigger = screen.getByRole("button", { name: "View Bruce's schedule" });
    await user.click(trigger);
    trigger.remove();

    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(grid).toHaveFocus());
    expect(grid.scrollLeft).toBe(37);
    expect(grid.scrollTop).toBe(19);
  });

  it("removes selected account content synchronously on an account switch", async () => {
    const user = userEvent.setup();
    render(<SchedulerGrid />, { wrapper: MemoryRouter });
    await user.click(screen.getByRole("button", { name: "View Bruce's schedule" }));
    expect(screen.getByRole("dialog", { name: "Bruce's schedule" })).toBeVisible();

    act(() => useStore.getState().setActiveAccount("a2"));

    expect(screen.queryByText("Bruce's schedule")).not.toBeInTheDocument();
  });

  it("preserves the dimmed placeholder surface and work-mode creation affordance", () => {
    useStore.getState().updateAccount(DEFAULT_ACCOUNT_ID, { placeholdersEnabled: true });
    useStore.getState().replaceAll({
      ...useStore.getState().data,
      resources: [makeResource({ accountId: DEFAULT_ACCOUNT_ID, kind: "placeholder", disciplineId: "d1" })],
      allocations: [],
    });
    useStore.getState().setFilters({ projectId: "p1", showUnmatched: true });
    render(<SchedulerGrid />, { wrapper: MemoryRouter });
    expect(screen.getByTestId("scheduler-row")).toHaveAttribute("data-dimmed", "true");
    expect(within(screen.getByTestId("scheduler-row")).getByRole("rowheader")).toHaveClass("hatch-lines");
    expect(screen.getByRole("button", { name: /Add allocation for Placeholder/ })).toBeVisible();
  });
});
