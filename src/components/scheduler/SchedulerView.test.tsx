import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SchedulerView } from "./SchedulerView";
import { useStore } from "../../store/useStore";
import { DEFAULT_ACCOUNT_ID } from "../../test/fixtures";
import { schedulerDataset } from "./__tests__/schedulerTestKit";

describe("SchedulerView", () => {
  beforeEach(() => {
    useStore.getState().replaceAll(schedulerDataset());
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
    useStore.getState().setOriginDate("2026-06-01");
    useStore.getState().setZoom(4);
    useStore.getState().clearFilters();
  });

  it("shows the toolbar controls and scheduled grid content together", () => {
    render(<SchedulerView />, { wrapper: MemoryRouter });

    expect(screen.getByRole("combobox", { name: "Weeks visible, 4 weeks" })).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "Resource schedule" })).toBeInTheDocument();
    expect(screen.getByText("Bruce")).toBeInTheDocument();
    expect(screen.getByText(/Wireframes/)).toBeInTheDocument();
  });
});
