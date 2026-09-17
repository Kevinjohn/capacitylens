import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ACCOUNT_ID, makeAccount, makeAppData, makeResource, resetStoreWithAccount } from "@/test/fixtures";
import { useStore } from "@/store/useStore";
import { CapacityOverviewView } from "./CapacityOverviewView";

vi.mock("../scheduler/useCalendarToday", () => ({ useCalendarToday: () => "2026-09-10" }));

describe("CapacityOverviewView", () => {
  beforeEach(() => resetStoreWithAccount());

  function renderOverview() {
    useStore.setState({
      activeAccountId: DEFAULT_ACCOUNT_ID,
      data: makeAppData({
        accounts: [makeAccount({ schedulingMode: "days", disciplinesEnabled: false })],
        resources: [makeResource({ id: "clark", accountId: DEFAULT_ACCOUNT_ID, name: "Clark Kent" })],
      }),
    });
    return render(<CapacityOverviewView />);
  }

  it("builds the current company overview from active scoped data", () => {
    useStore.setState({
      activeAccountId: DEFAULT_ACCOUNT_ID,
      data: makeAppData({
        accounts: [makeAccount({ schedulingMode: "days", disciplinesEnabled: false })],
        resources: [makeResource({ id: "clark", accountId: DEFAULT_ACCOUNT_ID, name: "Clark Kent" })],
      }),
    });

    render(<CapacityOverviewView />);

    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Clark Kent/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "10 – 13 Sep" })).toBeInTheDocument();
  });

  it("starts on the Ledger with tentative work shown and totals hidden", () => {
    renderOverview();

    expect(screen.getByRole("radio", { name: "Ledger" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Tentative" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Has availability" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Totals" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Capacity across the next 4 weeks")).toBeInTheDocument();
  });

  it("switches between the four-, eight- and twelve-week horizons without resetting other controls", async () => {
    const user = userEvent.setup();
    renderOverview();

    const table = screen.getByRole("table", { name: "Overview" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(5);
    expect(screen.getByRole("radio", { name: "4 weeks" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("radio", { name: "12 weeks" }));

    expect(within(table).getAllByRole("columnheader")).toHaveLength(13);
    expect(screen.getByRole("columnheader", { name: "5 – 11 Oct" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "23 – 29 Nov" })).toBeInTheDocument();
    expect(screen.getByText("Capacity across the next 12 weeks")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tentative" }));
    await user.click(screen.getByRole("button", { name: "Totals" }));
    await user.click(screen.getByRole("radio", { name: "8 weeks" }));

    expect(within(table).getAllByRole("columnheader")).toHaveLength(9);
    expect(screen.getByText("Capacity across the next 8 weeks")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentative" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Totals" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByTestId("capacity-overview-totals-cell")).toHaveLength(8);
  });

  it("resets the horizon when Overview is remounted", async () => {
    const user = userEvent.setup();
    const { unmount } = renderOverview();
    await user.click(screen.getByRole("radio", { name: "12 weeks" }));
    unmount();

    renderOverview();

    expect(screen.getByRole("radio", { name: "4 weeks" })).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByRole("table", { name: "Overview" })).getAllByRole("columnheader")).toHaveLength(5);
  });

  it("keeps a collapsed group collapsed while the horizon changes", async () => {
    const user = userEvent.setup();
    renderOverview();

    const groupToggle = screen.getByRole("button", { name: /Studio/ });
    await user.click(groupToggle);
    await user.click(screen.getByRole("radio", { name: "12 weeks" }));

    expect(groupToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("row", { name: /Clark Kent/ })).not.toBeInTheDocument();
  });

  it("opens the person schedule drawer from an Overview row", async () => {
    const user = userEvent.setup();
    useStore.setState({
      activeAccountId: DEFAULT_ACCOUNT_ID,
      data: makeAppData({
        accounts: [makeAccount({ schedulingMode: "days", disciplinesEnabled: false })],
        resources: [makeResource({ id: "clark", accountId: DEFAULT_ACCOUNT_ID, name: "Clark Kent" })],
      }),
    });

    render(<CapacityOverviewView />);

    const trigger = screen.getByRole("button", { name: "View Clark Kent's schedule" });
    expect(trigger).toHaveAttribute("data-testid", "person-schedule-trigger");
    await user.click(trigger);

    expect(screen.getByRole("dialog", { name: "Clark Kent's schedule" })).toBeVisible();
    expect(screen.getByTestId("person-schedule-sheet")).toBeInTheDocument();
  });

  it("uses the Blocks-mode explanation for an unmeasured company", () => {
    useStore.setState({
      activeAccountId: DEFAULT_ACCOUNT_ID,
      data: makeAppData({ accounts: [makeAccount({ schedulingMode: "blocks" })] }),
    });

    render(<CapacityOverviewView />);

    expect(screen.getByRole("heading", { name: "Overview needs measured capacity" })).toBeInTheDocument();
  });
});
