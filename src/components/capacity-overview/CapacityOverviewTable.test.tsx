import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Resource } from "@capacitylens/shared/types/entities";
import type { CapacityOverviewModel, CapacityOverviewWeekResult } from "./capacityOverviewModel";
import { CapacityOverviewTable } from "./CapacityOverviewTable";

const resource = (id: string, kind: Resource["kind"] = "person"): Resource => ({
  id,
  accountId: "account",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  kind,
  name: kind === "placeholder" ? "" : id,
  role: kind === "placeholder" ? "Designer" : "Designer",
  employmentType: "permanent",
  engagement: "studio",
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: "#2563eb",
  isFavourite: false,
});

const weeks = [
  { index: 0, key: "this-week", start: "2026-09-10", end: "2026-09-13", partial: true },
  { index: 1, key: "next-week", start: "2026-09-14", end: "2026-09-20", partial: false },
  { index: 2, key: "week-3", start: "2026-09-21", end: "2026-09-27", partial: false },
  { index: 3, key: "week-4", start: "2026-09-28", end: "2026-10-04", partial: false },
] as const;

function week(index: number, values: Partial<CapacityOverviewWeekResult>): CapacityOverviewWeekResult {
  const overviewWeek = weeks[index];
  if (!overviewWeek) throw new Error(`Missing test week ${index}`);
  return {
    week: overviewWeek,
    availableHours: 40,
    allocatedHours: 0,
    freeHours: 40,
    overHours: 0,
    freeDays: 5,
    overDays: 0,
    unassignedDemandHours: 0,
    unassignedDemandDays: 0,
    state: "available",
    ...values,
  };
}

const model: CapacityOverviewModel = {
  measured: true,
  weeks: [...weeks],
  groups: [
    {
      key: "design",
      title: "Design",
      rows: [
        {
          resource: resource("Clark Kent"),
          weeks: [
            // Hours are set (not just the rounded display days) so the bar-fill kind computed from
            // them matches what "over" days imply: overHours > 0 always wins the fill kind.
            week(0, { freeHours: 12, freeDays: 1.5, overHours: 2, overDays: 0.25 }),
            week(1, { state: "fully-booked", freeHours: 0, freeDays: 0 }),
            week(2, { state: "unavailable", availableHours: 0, freeHours: 0, freeDays: 0 }),
            week(3, {}),
          ],
        },
        {
          resource: resource("slot", "placeholder"),
          weeks: [
            week(0, { state: "unassigned", freeDays: 0, unassignedDemandDays: 2 }),
            week(1, { state: "unassigned", freeDays: 0 }),
            week(2, { state: "unassigned", freeDays: 0 }),
            week(3, { state: "unassigned", freeDays: 0 }),
          ],
        },
      ],
      summary: {
        scope: "all-eligible-people",
        peopleCount: 1,
        placeholderCount: 1,
        weeks: weeks.map((_item, index) => ({
          availableHours: 40,
          freeHours: index ? 40 : 12,
          overHours: index ? 0 : 2,
          freeDays: index ? 5 : 1.5,
          overDays: index ? 0 : 0.25,
          unassignedDemandHours: index ? 0 : 16,
          unassignedDemandDays: index ? 0 : 2,
        })),
      },
    },
  ],
  summary: {
    scope: "all-eligible-people",
    peopleCount: 1,
    placeholderCount: 1,
    weeks: weeks.map((_item, index) => ({
      availableHours: 40,
      freeHours: index ? 40 : 12,
      overHours: index ? 0 : 2,
      freeDays: index ? 5 : 1.5,
      overDays: index ? 0 : 0.25,
      unassignedDemandHours: index ? 0 : 16,
      unassignedDemandDays: index ? 0 : 2,
    })),
  },
};

describe("CapacityOverviewTable content", () => {
  it("renders weekly capacity, overbooking, states, demand, and all-eligible summaries", () => {
    render(
      <CapacityOverviewTable
        model={model}
        includeTentative
        hasAvailability={false}
        showTotals
        capacityDisplayMode="number"
        onIncludeTentativeChange={vi.fn()}
        onHasAvailabilityChange={vi.fn()}
        onShowTotalsChange={vi.fn()}
        onCapacityDisplayModeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "10 Sep – 13 Sep" })).not.toHaveTextContent("2026");
    expect(screen.getByRole("columnheader", { name: "28 Sep – 4 Oct" })).toBeInTheDocument();
    expect(screen.queryByText(/This week|Next week|Week 3|Week 4/)).not.toBeInTheDocument();
    const person = screen.getByRole("row", { name: /Clark Kent/ });
    expect(within(person).getByText("1.5d")).toBeInTheDocument();
    expect(within(person).getByText("0.25d overbooked")).toBeInTheDocument();
    const emptyCapacity = within(person).getAllByText("—");
    expect(emptyCapacity).toHaveLength(2);
    expect(emptyCapacity.every((value) => value.classList.contains("text-muted-foreground"))).toBe(true);
    expect(within(person).queryByText("Fully booked")).not.toBeInTheDocument();
    expect(within(person).queryByText("Unavailable")).not.toBeInTheDocument();
    const placeholder = screen.getByRole("row", { name: /Placeholder.*Designer/ });
    expect(within(placeholder).getByText("2d unassigned")).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /All eligible people/ })).not.toBeInTheDocument();
  });
});

describe("CapacityOverviewTable interactions", () => {
  it("updates both overview controls", async () => {
    const user = userEvent.setup();
    const onIncludeTentativeChange = vi.fn();
    const onHasAvailabilityChange = vi.fn();
    render(
      <CapacityOverviewTable
        model={model}
        includeTentative
        hasAvailability={false}
        showTotals={false}
        capacityDisplayMode="number"
        onIncludeTentativeChange={onIncludeTentativeChange}
        onHasAvailabilityChange={onHasAvailabilityChange}
        onShowTotalsChange={vi.fn()}
        onCapacityDisplayModeChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Hide tentative" }));
    await user.click(screen.getByRole("radio", { name: "Has availability" }));
    expect(onIncludeTentativeChange).toHaveBeenCalledWith(false);
    expect(onHasAvailabilityChange).toHaveBeenCalledWith(true);
  });

  it("switches the capacity display mode", async () => {
    const user = userEvent.setup();
    const onCapacityDisplayModeChange = vi.fn();
    render(
      <CapacityOverviewTable
        model={model}
        includeTentative
        hasAvailability={false}
        showTotals={false}
        capacityDisplayMode="number"
        onIncludeTentativeChange={vi.fn()}
        onHasAvailabilityChange={vi.fn()}
        onShowTotalsChange={vi.fn()}
        onCapacityDisplayModeChange={onCapacityDisplayModeChange}
      />,
    );

    await user.click(screen.getByRole("radio", { name: /^Bar$/ }));
    expect(onCapacityDisplayModeChange).toHaveBeenCalledWith("bar");
    await user.click(screen.getByRole("radio", { name: "Bar & number" }));
    expect(onCapacityDisplayModeChange).toHaveBeenCalledWith("bar-number");
  });

  it("hides group totals by default and shows them when toggled on", async () => {
    const user = userEvent.setup();
    const onShowTotalsChange = vi.fn();
    const { rerender } = render(
      <CapacityOverviewTable
        model={model}
        includeTentative
        hasAvailability={false}
        showTotals={false}
        capacityDisplayMode="number"
        onIncludeTentativeChange={vi.fn()}
        onHasAvailabilityChange={vi.fn()}
        onShowTotalsChange={onShowTotalsChange}
        onCapacityDisplayModeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: "Hide totals" })).toHaveAttribute("aria-checked", "true");
    const groupRow = screen.getByTestId("capacity-overview-group");
    expect(within(groupRow).queryByText("1.5d")).not.toBeInTheDocument();
    expect(within(groupRow).queryByText("0.25d overbooked")).not.toBeInTheDocument();
    expect(within(groupRow).queryByText("2d unassigned")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Show totals" }));
    expect(onShowTotalsChange).toHaveBeenCalledWith(true);

    rerender(
      <CapacityOverviewTable
        model={model}
        includeTentative
        hasAvailability={false}
        showTotals
        capacityDisplayMode="number"
        onIncludeTentativeChange={vi.fn()}
        onHasAvailabilityChange={vi.fn()}
        onShowTotalsChange={onShowTotalsChange}
        onCapacityDisplayModeChange={vi.fn()}
      />,
    );

    const groupRowWithTotals = screen.getByTestId("capacity-overview-group");
    expect(within(groupRowWithTotals).getByText("1.5d")).toBeInTheDocument();
    expect(within(groupRowWithTotals).getByText("0.25d overbooked")).toBeInTheDocument();
    expect(within(groupRowWithTotals).getByText("2d unassigned")).toBeInTheDocument();
  });

  it("renders Number mode with visible figures and no bar background", () => {
    render(
      <CapacityOverviewTable
        model={model}
        includeTentative
        hasAvailability={false}
        showTotals={false}
        capacityDisplayMode="number"
        onIncludeTentativeChange={vi.fn()}
        onHasAvailabilityChange={vi.fn()}
        onShowTotalsChange={vi.fn()}
        onCapacityDisplayModeChange={vi.fn()}
      />,
    );

    const person = screen.getByRole("row", { name: /Clark Kent/ });
    expect(within(person).getByText("1.5d")).toBeInTheDocument();
    const firstWeekCell = within(person).getByText("1.5d").closest("td");
    expect(within(firstWeekCell as HTMLElement).queryByTestId("capacity-bar-fill")).not.toBeInTheDocument();
  });

  it("renders Bar mode with a fill background and no visible number, keeping the value accessible", () => {
    render(
      <CapacityOverviewTable
        model={model}
        includeTentative
        hasAvailability={false}
        showTotals={false}
        capacityDisplayMode="bar"
        onIncludeTentativeChange={vi.fn()}
        onHasAvailabilityChange={vi.fn()}
        onShowTotalsChange={vi.fn()}
        onCapacityDisplayModeChange={vi.fn()}
      />,
    );

    const person = screen.getByRole("row", { name: /Clark Kent/ });
    expect(within(person).queryByText("1.5d")).not.toBeInTheDocument();
    const accessibleValue = within(person).getByText("1.5d, 0.25d overbooked");
    expect(accessibleValue).toHaveClass("sr-only");
    const firstWeekCell = accessibleValue.closest("td") as HTMLElement;
    const fill = within(firstWeekCell).getByTestId("capacity-bar-fill");
    // Overbooked (overHours > 0 wins the fill kind) and, in pure Bar mode, carries the diagonal
    // hatch — the non-colour cue for WCAG 1.4.1 since the number above is not visually rendered.
    expect(fill).toHaveAttribute("data-bar-kind", "over");
    expect(fill.style.background).toContain("repeating-linear-gradient");

    // A free (available) fill never carries the hatch — it needs no non-colour cue, since it
    // reads the same regardless of colour vision.
    const rowCells = within(person).getAllByRole("cell");
    const fourthWeekFill = within(rowCells[3] as HTMLElement).getByTestId("capacity-bar-fill");
    expect(fourthWeekFill).toHaveAttribute("data-bar-kind", "free");
    expect(fourthWeekFill.style.background).not.toContain("repeating-linear-gradient");
  });

  it("renders Bar & number mode with both the fill and the visible number", () => {
    render(
      <CapacityOverviewTable
        model={model}
        includeTentative
        hasAvailability={false}
        showTotals={false}
        capacityDisplayMode="bar-number"
        onIncludeTentativeChange={vi.fn()}
        onHasAvailabilityChange={vi.fn()}
        onShowTotalsChange={vi.fn()}
        onCapacityDisplayModeChange={vi.fn()}
      />,
    );

    const person = screen.getByRole("row", { name: /Clark Kent/ });
    const value = within(person).getByText("1.5d");
    expect(value).toBeInTheDocument();
    // The overbooked label is also visible here (unlike pure Bar mode) — SC 1.4.1 is already
    // satisfied by that printed text, so the hatch (which would sit under the same-hue label and
    // re-fail SC 1.4.3) is intentionally NOT applied in this mode.
    expect(within(person).getByText("0.25d overbooked")).toBeInTheDocument();
    const firstWeekCell = value.closest("td") as HTMLElement;
    const fill = within(firstWeekCell).getByTestId("capacity-bar-fill");
    expect(fill).toHaveAttribute("data-bar-kind", "over");
    expect(fill.style.background).not.toContain("repeating-linear-gradient");
  });

  it("never renders a bar for unassigned-demand rows", () => {
    render(
      <CapacityOverviewTable
        model={model}
        includeTentative
        hasAvailability={false}
        showTotals={false}
        capacityDisplayMode="bar"
        onIncludeTentativeChange={vi.fn()}
        onHasAvailabilityChange={vi.fn()}
        onShowTotalsChange={vi.fn()}
        onCapacityDisplayModeChange={vi.fn()}
      />,
    );

    const placeholder = screen.getByRole("row", { name: /Placeholder.*Designer/ });
    const value = within(placeholder).getByText("2d unassigned");
    const cell = value.closest("td") as HTMLElement;
    expect(within(cell).queryByTestId("capacity-bar-fill")).not.toBeInTheDocument();
  });

  it("collapses and expands discipline rows", async () => {
    const user = userEvent.setup();
    render(
      <CapacityOverviewTable
        model={model}
        includeTentative
        hasAvailability={false}
        showTotals={false}
        capacityDisplayMode="number"
        onIncludeTentativeChange={vi.fn()}
        onHasAvailabilityChange={vi.fn()}
        onShowTotalsChange={vi.fn()}
        onCapacityDisplayModeChange={vi.fn()}
      />,
    );

    const groupToggle = screen.getByRole("button", { name: "Design" });
    expect(groupToggle).toHaveAttribute("aria-expanded", "true");
    await user.click(groupToggle);
    expect(groupToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("row", { name: /Clark Kent/ })).not.toBeInTheDocument();
    await user.click(groupToggle);
    expect(screen.getByRole("row", { name: /Clark Kent/ })).toBeInTheDocument();
  });

  it("shows an explanation instead of figures in Blocks mode", () => {
    render(
      <CapacityOverviewTable
        model={{ ...model, measured: false, reason: "blocks-mode", groups: [] }}
        includeTentative
        hasAvailability={false}
        showTotals={false}
        capacityDisplayMode="number"
        onIncludeTentativeChange={vi.fn()}
        onHasAvailabilityChange={vi.fn()}
        onShowTotalsChange={vi.fn()}
        onCapacityDisplayModeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Overview needs measured capacity" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
