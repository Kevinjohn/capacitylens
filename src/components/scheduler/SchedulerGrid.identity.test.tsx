import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
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
  });

  it("preserves the dimmed placeholder surface and work-mode creation affordance", () => {
    useStore.getState().updateAccount(DEFAULT_ACCOUNT_ID, { placeholdersEnabled: true });
    useStore.getState().replaceAll({
      ...useStore.getState().data,
      resources: [
        makeResource({ accountId: DEFAULT_ACCOUNT_ID, kind: "placeholder", name: undefined, disciplineId: "d1" }),
      ],
      allocations: [],
    });
    useStore.getState().setFilters({ projectId: "p1", showUnmatched: true });
    render(<SchedulerGrid />, { wrapper: MemoryRouter });
    expect(screen.getByTestId("scheduler-row")).toHaveAttribute("data-dimmed", "true");
    expect(within(screen.getByTestId("scheduler-row")).getByRole("rowheader")).toHaveClass("hatch-lines");
    expect(screen.getByRole("button", { name: /Add allocation for Placeholder/ })).toBeVisible();
  });
});
