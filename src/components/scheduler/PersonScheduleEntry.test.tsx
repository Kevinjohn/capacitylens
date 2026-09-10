import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PersonScheduleAllocationEntry, PersonScheduleTimeOffEntry } from "./personScheduleTypes";
import { PersonScheduleEntry } from "./PersonScheduleEntry";

describe("PersonScheduleEntry", () => {
  it("renders every allocation detail as readable, read-only content", () => {
    const entry: PersonScheduleAllocationEntry = {
      kind: "allocation",
      key: "allocation:a1",
      sourceId: "a1",
      activity: "Prototype discovery",
      project: "Project Gotham",
      client: "Wayne Enterprises",
      color: "#2563eb",
      status: "confirmed",
      hoursPerDay: 6.25,
      startDate: "2026-12-28",
      endDate: "2027-01-08",
      seriesEnd: "2027-01-15",
      note: "Review the research\nThen prepare the workshop.",
    };

    render(
      <ul>
        <PersonScheduleEntry entry={entry} />
      </ul>,
    );

    const item = screen.getByTestId("person-schedule-entry");
    expect(item).toHaveAttribute("data-entry-id", "allocation:a1");
    expect(within(item).getByText("Prototype discovery")).toBeVisible();
    expect(within(item).getByText("Project Gotham · Wayne Enterprises")).toBeVisible();
    expect(within(item).getByText("28 Dec 2026 – 8 Jan 2027")).toBeVisible();
    expect(within(item).getByText(/6\.25h\/day/)).toBeVisible();
    expect(within(item).getByText("Confirmed")).toBeVisible();
    expect(within(item).getByText("Series through 15 Jan 2027")).toBeVisible();
    expect(within(item).getByText(/Review the research/)).toHaveClass("whitespace-pre-wrap");
    expect(within(item).getByTestId("person-schedule-colour")).toHaveAttribute("aria-hidden", "true");
    expect(within(item).queryByRole("button")).not.toBeInTheDocument();
    expect(within(item).queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders personal time off distinctly, including an already-authorized note", () => {
    const entry: PersonScheduleTimeOffEntry = {
      kind: "timeOff",
      key: "timeOff:t1",
      sourceId: "t1",
      type: "holiday",
      startDate: "2026-09-10",
      endDate: "2026-09-10",
      note: "Family day",
    };

    render(
      <ul>
        <PersonScheduleEntry entry={entry} />
      </ul>,
    );

    const item = screen.getByTestId("person-schedule-entry");
    expect(item).toHaveAttribute("data-entry-kind", "timeOff");
    expect(within(item).getByText("Holiday")).toBeVisible();
    expect(within(item).getByText("10 Sep 2026")).toBeVisible();
    expect(within(item).getByText("Family day")).toHaveClass("whitespace-pre-wrap");
    expect(within(item).getByTestId("person-schedule-timeoff-accent")).toHaveAttribute("aria-hidden", "true");
    expect(within(item).queryByRole("button")).not.toBeInTheDocument();
  });
});
