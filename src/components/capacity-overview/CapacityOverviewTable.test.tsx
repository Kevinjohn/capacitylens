import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData, Resource } from "@capacitylens/shared/types/entities";
import type { CapacityDisplayMode } from "./capacityOverviewBar";
import {
  buildCapacityOverviewModel,
  type CapacityOverviewModel,
  type CapacityOverviewPeriodResult,
  type CapacityOverviewSummaryPeriod,
} from "./capacityOverviewModel";
import { CapacityOverviewTable } from "./CapacityOverviewTable";

const resource = (id: string, kind: Resource["kind"] = "person"): Resource => ({
  id,
  accountId: "account",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  kind,
  name: kind === "placeholder" ? "" : id,
  role: "Designer",
  employmentType: "permanent",
  engagement: "studio",
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: "#2563eb",
  isFavourite: false,
});

const periods = [
  { index: 0, key: "this-week", start: "2026-09-10", end: "2026-09-13", partial: true },
  { index: 1, key: "next-week", start: "2026-09-14", end: "2026-09-20", partial: false },
  { index: 2, key: "week-3", start: "2026-09-21", end: "2026-09-27", partial: false },
  { index: 3, key: "week-4", start: "2026-09-28", end: "2026-10-04", partial: false },
] as const;

function period(index: number, values: Partial<CapacityOverviewPeriodResult>): CapacityOverviewPeriodResult {
  const overviewPeriod = periods[index];
  if (!overviewPeriod) throw new Error(`Missing test period ${index}`);
  return {
    period: overviewPeriod,
    companyWorkingHours: 40,
    availableHours: 40,
    allocatedHours: 0,
    freeHours: 40,
    overHours: 0,
    tentativeHours: 0,
    freeDays: 5,
    overDays: 0,
    tentativeDays: 0,
    unassignedDemandHours: 0,
    unassignedDemandDays: 0,
    state: "available",
    ...values,
  };
}

const summaryPeriod = (values: Partial<CapacityOverviewSummaryPeriod> = {}): CapacityOverviewSummaryPeriod => ({
  availableHours: 40,
  freeHours: 40,
  overHours: 0,
  tentativeHours: 0,
  freeDays: 5,
  overDays: 0,
  tentativeDays: 0,
  unassignedDemandHours: 0,
  unassignedDemandDays: 0,
  ...values,
});

const clarkKent = { ...resource("Clark Kent"), avatarUrl: "https://images.example/clark.png" };
const placeholderSlot = resource("slot", "placeholder");

// Real (if minimal) AppData, matched by id to the model's rows above, so the person schedule
// trigger resolves the real per-resource title instead of the fallback an empty dataset produces.
const data: AppData = { ...emptyAppData(), resources: [clarkKent, placeholderSlot] };

const summary = {
  scope: "all-eligible-people" as const,
  peopleCount: 1,
  placeholderCount: 1,
  periods: periods.map((_item, index) => summaryPeriod(index ? {} : { freeHours: 12, freeDays: 1.5 })),
};

const model: CapacityOverviewModel = {
  measured: true,
  periods: [...periods],
  groups: [
    {
      key: "design",
      title: "Design",
      rows: [
        {
          resource: clarkKent,
          periods: [
            period(0, {
              freeHours: 12,
              freeDays: 1.5,
              tentativeHours: 8,
              tentativeDays: 1,
              overHours: 2,
              overDays: 0.25,
            }),
            period(1, { state: "fully-booked", freeHours: 0, freeDays: 0 }),
            period(2, { state: "unavailable", availableHours: 0, freeHours: 0, freeDays: 0 }),
            period(3, { availableHours: 32, freeHours: 32, freeDays: 4 }),
          ],
        },
        {
          resource: placeholderSlot,
          periods: [
            period(0, { state: "unassigned", freeDays: 0, unassignedDemandDays: 2 }),
            period(1, { state: "unassigned", freeDays: 0 }),
            period(2, { state: "unassigned", freeDays: 0 }),
            period(3, { state: "unassigned", freeDays: 0 }),
          ],
        },
      ],
      summary,
    },
  ],
  summary,
};

function renderTable(
  overrides: Partial<{
    model: CapacityOverviewModel;
    showTotals: boolean;
    capacityDisplayMode: CapacityDisplayMode;
    includeTentative: boolean;
    onIncludeTentativeChange: (checked: boolean) => void;
    onHasAvailabilityChange: (checked: boolean) => void;
    onShowTotalsChange: (checked: boolean) => void;
    onCapacityDisplayModeChange: (mode: CapacityDisplayMode) => void;
  }> = {},
) {
  const props = {
    model,
    horizon: "4-weeks" as const,
    data,
    includeTentative: true,
    hasAvailability: false,
    showTotals: false,
    capacityDisplayMode: "ledger" as const,
    onHorizonChange: vi.fn(),
    onIncludeTentativeChange: vi.fn(),
    onHasAvailabilityChange: vi.fn(),
    onShowTotalsChange: vi.fn(),
    onCapacityDisplayModeChange: vi.fn(),
    ...overrides,
  };
  const view = render(<CapacityOverviewTable {...props} />);
  return {
    ...view,
    rerender: (next: typeof overrides) => view.rerender(<CapacityOverviewTable {...props} {...next} />),
  };
}

describe("CapacityOverviewTable content", () => {
  it("renders twelve aligned week columns and a keyboard scroll region", () => {
    const twelveWeekModel = buildCapacityOverviewModel({
      data,
      today: "2026-06-03",
      horizon: "12-weeks",
      disciplinesEnabled: false,
    });

    renderTable({ model: twelveWeekModel });

    const table = screen.getByRole("table", { name: "Overview" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(13);
    expect(within(table).getByRole("columnheader", { name: "3 – 7 Jun" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "17 – 23 Aug" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Overview table" })).toHaveAttribute("tabindex", "0");
  });

  it("derives an empty table span from the displayed week count", () => {
    const twelveWeekModel = buildCapacityOverviewModel({
      data: { ...emptyAppData(), resources: [] },
      today: "2026-06-03",
      horizon: "12-weeks",
    });
    renderTable({ model: twelveWeekModel });

    expect(screen.getByText("No people match this view.")).toHaveAttribute("colspan", "13");
  });

  it("renders the ledger: free days out of capacity, overbooking, dashes and unassigned demand", () => {
    class LoadedImage {
      complete = true;
      naturalWidth = 1;
      crossOrigin: string | null = null;
      referrerPolicy = "";
      src = "";
      addEventListener() {}
      removeEventListener() {}
    }
    vi.stubGlobal("Image", LoadedImage);
    try {
      const { container } = renderTable();

      expect(screen.getByRole("columnheader", { name: "10 – 13 Sep" })).not.toHaveTextContent("2026");
      expect(screen.getByRole("columnheader", { name: "28 Sep – 4 Oct" })).toBeInTheDocument();
      const person = screen.getByRole("row", { name: /Clark Kent/ });
      const avatar = container.querySelector('button[aria-label="View Clark Kent\'s schedule"] img');
      expect(avatar).toHaveAttribute("src", "https://images.example/clark.png");
      expect(avatar).toHaveAttribute("referrerpolicy", "no-referrer");
      const cells = within(person).getAllByRole("cell");
      expect(within(cells[0] as HTMLElement).getByText("1.5d")).toHaveClass("text-ink");
      expect(within(cells[0] as HTMLElement).getByText("/ 5d")).toBeInTheDocument();
      // Overbooking never prints inside the cell (it would wrap in narrow twelve-week columns): the
      // track carries a red hatch and the figure lives in the hover text and the sr-only label.
      expect(within(cells[0] as HTMLElement).queryByText("0.25d overbooked")).not.toBeInTheDocument();
      expect(within(cells[0] as HTMLElement).getByTestId("capacity-ledger-bar")).toHaveAttribute("data-over", "true");
      expect(within(cells[0] as HTMLElement).getByTestId("capacity-ledger-bar").style.background).toContain(
        "var(--color-danger)",
      );
      expect(
        within(cells[0] as HTMLElement).getByText("10 – 13 Sep · 1.5d free of 5d · 1d tentative · 0.25d overbooked"),
      ).toHaveClass("sr-only");
      expect(cells[0]).toHaveAttribute("title", "10 – 13 Sep · 1.5d free of 5d · 1d tentative · 0.25d overbooked");
      expect(within(cells[1] as HTMLElement).getByTestId("capacity-ledger-bar")).not.toHaveAttribute("data-over");
      const emptyCapacity = within(person).getAllByText("—");
      expect(emptyCapacity).toHaveLength(2);
      expect(emptyCapacity.every((value) => value.classList.contains("text-faint"))).toBe(true);
      expect(within(cells[2] as HTMLElement).getByText("/ 0d")).toBeInTheDocument();
      expect(within(cells[3] as HTMLElement).getByText("/ 4d")).toBeInTheDocument();
      const placeholder = screen.getByRole("row", { name: /Placeholder.*Designer/ });
      expect(within(placeholder).getByText("2d unassigned")).toBeInTheDocument();
      expect(within(placeholder).queryByTestId("capacity-ledger-bar")).not.toBeInTheDocument();
      expect(within(screen.getByTestId("capacity-overview-group")).getByText("2 people")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("colours the ledger bar by the share of capacity still free and hatches tentative time", () => {
    renderTable();

    const cells = within(screen.getByRole("row", { name: /Clark Kent/ })).getAllByRole("cell");
    const firstFree = within(cells[0] as HTMLElement).getByTestId("capacity-bar-free");
    expect(firstFree).toHaveAttribute("data-tone", "danger");
    expect(firstFree).toHaveStyle({ width: "30%" });
    const firstTentative = within(cells[0] as HTMLElement).getByTestId("capacity-bar-tentative");
    expect(firstTentative).toHaveStyle({ width: "20%" });
    expect(firstTentative.style.background).toContain("repeating-linear-gradient");
    expect(firstTentative.style.background).toContain("var(--color-faint)");
    expect(within(cells[1] as HTMLElement).getByTestId("capacity-bar-free")).toHaveStyle({ width: "0%" });
    const fourthFree = within(cells[3] as HTMLElement).getByTestId("capacity-bar-free");
    expect(fourthFree).toHaveAttribute("data-tone", "ok");
    expect(fourthFree).toHaveStyle({ width: "100%" });
  });

  it("names a placeholder's trigger from its role, not the generic placeholder fallback", () => {
    renderTable();

    // Without a real resource behind it, the trigger's title degrades to the generic
    // "View Placeholder's schedule" instead of naming the role — the case a defaulted-to-empty
    // `data` prop was silently masking.
    const trigger = screen.getByRole("button", { name: "View Placeholder — Designer's schedule" });
    expect(trigger).toHaveAttribute("data-testid", "person-schedule-trigger");
  });
});

describe("CapacityOverviewTable interactions", () => {
  it("toggles the tentative and availability pills", async () => {
    const user = userEvent.setup();
    const onIncludeTentativeChange = vi.fn();
    const onHasAvailabilityChange = vi.fn();
    renderTable({ onIncludeTentativeChange, onHasAvailabilityChange });

    const tentative = screen.getByRole("button", { name: "Tentative" });
    expect(tentative).toHaveAttribute("aria-pressed", "true");
    await user.click(tentative);
    expect(onIncludeTentativeChange).toHaveBeenCalledWith(false);
    const availability = screen.getByRole("button", { name: "Has availability" });
    expect(availability).toHaveAttribute("aria-pressed", "false");
    await user.click(availability);
    expect(onHasAvailabilityChange).toHaveBeenCalledWith(true);
  });

  it("switches between Ledger and Load curve", async () => {
    const user = userEvent.setup();
    const onCapacityDisplayModeChange = vi.fn();
    renderTable({ onCapacityDisplayModeChange });

    expect(screen.getByRole("radio", { name: "Ledger" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("radio", { name: "Load curve" }));
    expect(onCapacityDisplayModeChange).toHaveBeenCalledWith("load-curve");
  });

  it("hides the totals tier by default and shows visible-people totals when toggled on", async () => {
    const user = userEvent.setup();
    const onShowTotalsChange = vi.fn();
    const { rerender } = renderTable({ onShowTotalsChange });

    const totals = screen.getByRole("button", { name: "Totals" });
    expect(totals).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("capacity-overview-totals")).not.toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByRole("columnheader")).toHaveLength(5);

    await user.click(totals);
    expect(onShowTotalsChange).toHaveBeenCalledWith(true);

    rerender({ showTotals: true });
    const totalsRow = screen.getByTestId("capacity-overview-totals");
    const totalsCells = within(totalsRow).getAllByTestId("capacity-overview-totals-cell");
    expect(totalsCells).toHaveLength(4);
    // Clark: 40h capacity, 12h free, 8h tentative → 20h committed (50%), 20% tentative, 1.5d free.
    expect(within(totalsCells[0] as HTMLElement).getByText("50%")).toHaveClass("text-muted-foreground");
    expect(within(totalsCells[0] as HTMLElement).getByText("1.5d")).toBeInTheDocument();
    expect(totalsCells[0]).toHaveAttribute("title", "10 – 13 Sep · 2.5d committed of 5d · 1d tentative");
    expect(within(totalsCells[0] as HTMLElement).getByTestId("capacity-totals-committed")).toHaveStyle({
      width: "50%",
    });
    expect(within(totalsCells[0] as HTMLElement).getByTestId("capacity-totals-tentative")).toHaveStyle({
      width: "20%",
    });
    // Fully booked: 100% committed reads as danger; unavailable weeks have no capacity at all.
    expect(within(totalsCells[1] as HTMLElement).getByText("100%")).toHaveClass("text-danger");
    expect(totalsCells[2]).toHaveAttribute("title", "21 – 27 Sep · 0d committed of 0d");
    // The tier adds no column header and its person cell stays empty, so nothing shifts.
    expect(within(screen.getByRole("table")).getAllByRole("columnheader")).toHaveLength(5);
    expect(totalsRow.firstElementChild).toBeEmptyDOMElement();
    expect(within(screen.getByTestId("capacity-overview-group")).queryByText(/committed/)).not.toBeInTheDocument();
  });

  it("renders Load curve with shape only, keeping the figures for assistive technology", () => {
    renderTable({ capacityDisplayMode: "load-curve" });

    const person = screen.getByRole("row", { name: /Clark Kent/ });
    expect(within(person).queryByText("1.5d")).not.toBeInTheDocument();
    expect(within(person).queryByText("/ 5d")).not.toBeInTheDocument();
    const accessibleValue = within(person).getByText("10 – 13 Sep · 1.5d free of 5d · 1d tentative · 0.25d overbooked");
    expect(accessibleValue).toHaveClass("sr-only");
    expect(within(person).queryByTestId("capacity-ledger-bar")).not.toBeInTheDocument();
    const firstWeekCell = accessibleValue.closest("td") as HTMLElement;
    const curve = within(firstWeekCell).getByTestId("capacity-load-curve");
    // Overbooked weeks keep a red hatch on the track as the non-colour cue (WCAG 1.4.1).
    expect(curve).toHaveAttribute("data-over", "true");
    expect(curve.style.background).toContain("repeating-linear-gradient");
    expect(within(curve).getByTestId("capacity-bar-free")).toHaveStyle({ height: "30%" });
    expect(within(curve).getByTestId("capacity-bar-tentative")).toHaveStyle({ height: "20%" });

    const cells = within(person).getAllByRole("cell");
    const fourthCurve = within(cells[3] as HTMLElement).getByTestId("capacity-load-curve");
    expect(fourthCurve).not.toHaveAttribute("data-over");
    expect(within(fourthCurve).getByTestId("capacity-bar-free")).toHaveStyle({ height: "100%" });
    expect(within(fourthCurve).getByTestId("capacity-bar-free")).toHaveAttribute("data-tone", "ok");
    expect(within(fourthCurve).getByTestId("capacity-bar-free").style.background).toBe("var(--color-ok)");
  });

  it("drops the tentative band when tentative work is excluded", () => {
    const withoutTentative: CapacityOverviewModel = {
      ...model,
      groups: model.groups.map((group) => ({
        ...group,
        rows: group.rows.map((row) => ({
          ...row,
          periods: row.periods.map((result) => ({ ...result, tentativeHours: 0, tentativeDays: 0 })),
        })),
      })),
    };
    renderTable({ model: withoutTentative, includeTentative: false, showTotals: true });

    const cells = within(screen.getByRole("row", { name: /Clark Kent/ })).getAllByRole("cell");
    expect(within(cells[0] as HTMLElement).getByTestId("capacity-bar-tentative")).toHaveStyle({ width: "0%" });
    expect(cells[0]).toHaveAttribute("title", "10 – 13 Sep · 1.5d free of 5d · 0.25d overbooked");
    const totalsCell = screen.getAllByTestId("capacity-overview-totals-cell")[0] as HTMLElement;
    expect(totalsCell).toHaveAttribute("title", "10 – 13 Sep · 3.5d committed of 5d");
    expect(screen.getByRole("button", { name: "Tentative" })).toHaveAttribute("aria-pressed", "false");
  });

  it("never renders a bar for unassigned-demand rows in either mode", () => {
    const { rerender } = renderTable({ capacityDisplayMode: "load-curve" });

    const placeholder = screen.getByRole("row", { name: /Placeholder.*Designer/ });
    expect(within(placeholder).getByText("2d unassigned")).toBeInTheDocument();
    expect(within(placeholder).queryByTestId("capacity-load-curve")).not.toBeInTheDocument();
    rerender({ capacityDisplayMode: "ledger" });
    expect(within(placeholder).queryByTestId("capacity-ledger-bar")).not.toBeInTheDocument();
  });

  it("collapses and expands discipline rows", async () => {
    const user = userEvent.setup();
    renderTable();

    const groupToggle = screen.getByRole("button", { name: /^Design/ });
    expect(groupToggle).toHaveAttribute("aria-expanded", "true");
    await user.click(groupToggle);
    expect(groupToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("row", { name: /Clark Kent/ })).not.toBeInTheDocument();
    await user.click(groupToggle);
    expect(screen.getByRole("row", { name: /Clark Kent/ })).toBeInTheDocument();
  });

  it("shows an explanation instead of figures in Blocks mode", () => {
    renderTable({ model: { ...model, measured: false, reason: "blocks-mode", groups: [] } });

    expect(screen.getByRole("heading", { name: "Overview needs measured capacity" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("capacity-overview-legend")).not.toBeInTheDocument();
  });
});
